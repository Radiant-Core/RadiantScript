import { binToHex } from '@bitauth/libauth';
import {
  AbiFunction,
  Artifact,
  asmToScript,
  calculateBytesize,
  countOpcodes,
  generateRedeemScript,
  Script,
  scriptToBytecode,
} from '@radiantscript/utils';
import { Transaction } from './Transaction.js';
import { Argument, encodeArgument } from './Argument.js';
import { Utxo } from './interfaces.js';
import NetworkProvider from './network/NetworkProvider.js';
import {
  scriptToAddress,
} from './utils.js';
import SignatureTemplate from './SignatureTemplate.js';
import { ElectrumNetworkProvider } from './network/index.js';

export class Contract {
  name: string;
  address: string;
  bytesize: number;
  opcount: number;

  functions: {
    [name: string]: ContractFunction,
  };

  private redeemScript: Script;

  constructor(
    private artifact: Artifact,
    constructorArgs: Argument[],
    private provider: NetworkProvider = new ElectrumNetworkProvider(),
  ) {
    const expectedProperties = ['abi', 'asm', 'contract'];
    if (!expectedProperties.every((property) => property in artifact)) {
      throw new Error('Invalid or incomplete artifact provided');
    }

    const ctorEntry = artifact.abi.find((f) => f.type === 'constructor');
    const constructorInputs = artifact.constructorInputs ?? ctorEntry?.params ?? [];
    const contractName = artifact.contractName ?? artifact.contract;

    if (constructorInputs.length !== constructorArgs.length) {
      throw new Error(`Incorrect number of arguments passed to ${contractName} constructor`);
    }

    // Encode arguments (this also performs type checking)
    const encodedArgs = constructorArgs
      .map((arg, i) => encodeArgument(arg, constructorInputs[i].type))
      .reverse();

    // Check there's no signature templates in the constructor
    if (encodedArgs.some((arg) => arg instanceof SignatureTemplate)) {
      throw new Error('Cannot use signatures in constructor');
    }

    const bytecode = this.artifact.bytecode ?? this.artifact.asm;
    this.redeemScript = generateRedeemScript(
      asmToScript(bytecode),
      encodedArgs as Uint8Array[],
    );

    // Populate the functions object with the contract's functions
    // (with a special case for single function, which has no "function selector")
    this.functions = {};
    if (artifact.abi.length === 1) {
      const f = artifact.abi[0];
      if (f.name) this.functions[f.name] = this.createFunction(f);
    } else {
      artifact.abi.forEach((f, i) => {
        if (f.name) this.functions[f.name] = this.createFunction(f, i);
      });
    }

    this.name = artifact.contractName ?? artifact.contract;
    this.address = scriptToAddress(this.redeemScript, this.provider.network);
    this.bytesize = calculateBytesize(this.redeemScript);
    this.opcount = countOpcodes(this.redeemScript);
  }

  async getBalance(): Promise<number> {
    const utxos = await this.getUtxos();
    return utxos.reduce((acc, utxo) => acc + utxo.satoshis, 0);
  }

  async getUtxos(): Promise<Utxo[]> {
    return this.provider.getUtxos(this.address);
  }

  getRedeemScriptHex(): string {
    return binToHex(scriptToBytecode(this.redeemScript));
  }

  private createFunction(abiFunction: AbiFunction, selector?: number): ContractFunction {
    return (...args: Argument[]) => {
      const fnInputs = abiFunction.inputs ?? abiFunction.params;
      if (fnInputs.length !== args.length) {
        throw new Error(`Incorrect number of arguments passed to function ${abiFunction.name}`);
      }

      // Encode passed args (this also performs type checking)
      const encodedArgs = args
        .map((arg, i) => encodeArgument(arg, fnInputs[i].type));

      return new Transaction(
        this.address,
        this.provider,
        this.redeemScript,
        abiFunction,
        encodedArgs,
        selector,
      );
    };
  }
}

export type ContractFunction = (...args: Argument[]) => Transaction;
