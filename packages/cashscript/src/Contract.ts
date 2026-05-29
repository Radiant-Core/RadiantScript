import { binToHex, hexToBin } from '@bitauth/libauth';
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
import { buildStatefulOutput } from './RadiantHelpers.js';
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
    validateArtifact(artifact);

    const constructorAbi = artifact.abi.find((f) => f.type === 'constructor');
    if (!constructorAbi) {
      throw new Error(`Artifact for ${artifact.contract} is missing a constructor ABI entry`);
    }

    if (constructorAbi.params.length !== constructorArgs.length) {
      throw new Error(`Incorrect number of arguments passed to ${artifact.contract} constructor`);
    }

    // Encode arguments (this also performs type checking)
    const encodedArgs = constructorArgs
      .map((arg, i) => encodeArgument(arg, constructorAbi.params[i].type))
      .reverse();

    // Check there's no signature templates in the constructor
    if (encodedArgs.some((arg) => arg instanceof SignatureTemplate)) {
      throw new Error('Cannot use signatures in constructor');
    }

    this.redeemScript = generateRedeemScript(
      asmToScript(this.artifact.asm),
      encodedArgs as Uint8Array[],
    );

    // Populate the functions object with the contract's functions. The ABI
    // also contains a `type: 'constructor'` entry (no `name`); skip it here.
    // Single-function contracts get no "function selector" argument.
    this.functions = {};
    const functions = artifact.abi.filter((entry) => entry.type === 'function');
    if (functions.length === 1) {
      const f = functions[0];
      this.functions[f.name!] = this.createFunction(f);
    } else {
      functions.forEach((f, i) => {
        this.functions[f.name!] = this.createFunction(f, i);
      });
    }

    this.name = artifact.contract;
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

  /**
   * Build a stateful output with updated state data for transferring ownership.
   *
   * Stateful contracts (like FungibleToken, domain names, wave names) store the
   * owner's identity in the UTXO's state section. When transferring to a new
   * owner, the output MUST include the new owner's identity (e.g., pkh) in its
   * state section, otherwise the new owner will not be able to sign future
   * transactions.
   *
   * Usage:
   * ```typescript
   * const newOwnerPkh = hash160(newOwnerPubKey);
   * const statefulOutput = contract.buildStatefulOutput(newOwnerPkh);
   *
   * await contract.functions
   *   .transfer(currentOwnerPk, new SignatureTemplate(currentOwnerPrivKey))
   *   .to(statefulOutput, amount)  // Pass Uint8Array, not address string!
   *   .send();
   * ```
   *
   * @param stateData  The new state bytes (e.g., 20-byte pkh of new owner)
   * @returns          A Uint8Array to use as the output's lockingBytecode
   */
  buildStatefulOutput(stateData: Uint8Array): Uint8Array {
    const codeScript = hexToBin(this.getRedeemScriptHex());
    return buildStatefulOutput(stateData, codeScript);
  }

  private createFunction(abiFunction: AbiFunction, selector?: number): ContractFunction {
    return (...args: Argument[]) => {
      if (abiFunction.params.length !== args.length) {
        throw new Error(`Incorrect number of arguments passed to function ${abiFunction.name}`);
      }

      // Encode passed args (this also performs type checking)
      const encodedArgs = args
        .map((arg, i) => encodeArgument(arg, abiFunction.params[i].type));

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

/**
 * Validate that a third-party artifact matches the expected schema before the
 * compiler/runtime tries to use it. Catches malformed JSON early instead of
 * surfacing as a downstream TypeError. Throws with a descriptive message
 * naming the offending field on failure.
 */
function validateArtifact(artifact: unknown): asserts artifact is Artifact {
  if (artifact === null || typeof artifact !== 'object') {
    throw new Error('Invalid artifact: expected an object');
  }
  const a = artifact as Record<string, unknown>;

  if (typeof a.contract !== 'string' || a.contract.length === 0) {
    throw new Error('Invalid artifact: "contract" must be a non-empty string');
  }
  if (typeof a.asm !== 'string' || a.asm.length === 0) {
    throw new Error(`Invalid artifact (${a.contract}): "asm" must be a non-empty string`);
  }
  if (!Array.isArray(a.abi)) {
    throw new Error(`Invalid artifact (${a.contract}): "abi" must be an array`);
  }

  let sawConstructor = false;
  a.abi.forEach((entry, idx) => {
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`Invalid artifact (${a.contract}): abi[${idx}] must be an object`);
    }
    const fn = entry as Record<string, unknown>;
    if (fn.type !== 'function' && fn.type !== 'constructor') {
      throw new Error(
        `Invalid artifact (${a.contract}): abi[${idx}].type must be 'function' or 'constructor'`,
      );
    }
    if (fn.type === 'constructor') sawConstructor = true;
    if (fn.type === 'function' && typeof fn.name !== 'string') {
      throw new Error(`Invalid artifact (${a.contract}): abi[${idx}].name must be a string for functions`);
    }
    if (!Array.isArray(fn.params)) {
      throw new Error(`Invalid artifact (${a.contract}): abi[${idx}].params must be an array`);
    }
    fn.params.forEach((p, pidx) => {
      if (p === null || typeof p !== 'object') {
        throw new Error(`Invalid artifact (${a.contract}): abi[${idx}].params[${pidx}] must be an object`);
      }
      const param = p as Record<string, unknown>;
      if (typeof param.name !== 'string') {
        throw new Error(
          `Invalid artifact (${a.contract}): abi[${idx}].params[${pidx}].name must be a string`,
        );
      }
      if (typeof param.type !== 'string') {
        throw new Error(
          `Invalid artifact (${a.contract}): abi[${idx}].params[${pidx}].type must be a string`,
        );
      }
    });
  });

  if (!sawConstructor) {
    throw new Error(`Invalid artifact (${a.contract}): abi is missing a constructor entry`);
  }
}
