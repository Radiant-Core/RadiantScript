import {
  DeploymentConfig,
  DeploymentResult,
  DeployOptions,
  ContractArtifact,
  WalletConfig,
} from './types';
import { createDeploymentConfig } from './network';

export class DeploymentManager {
  private config: DeploymentConfig;
  private electrumClient: any;
  private radiantjs: any;

  constructor(network: 'mainnet' | 'testnet' = 'mainnet') {
    this.config = createDeploymentConfig(network);
  }

  async connect(): Promise<void> {
    const { ElectrumClient } = await import('ws-electrumx-client');
    const url = `${this.config.electrumProtocol}://${this.config.electrumHost}:${this.config.electrumPort}`;
    this.electrumClient = new ElectrumClient(url);
    await this.electrumClient.connect();
  }

  async disconnect(): Promise<void> {
    if (this.electrumClient) {
      await this.electrumClient.disconnect();
    }
  }

  async getBalance(address: string): Promise<number> {
    if (!this.electrumClient) {
      throw new Error('Not connected. Call connect() first.');
    }
    const result = await this.electrumClient.request('blockchain.address.get_balance', [address]);
    return result.confirmed + result.unconfirmed;
  }

  async getUtxos(address: string): Promise<any[]> {
    if (!this.electrumClient) {
      throw new Error('Not connected. Call connect() first.');
    }
    return await this.electrumClient.request('blockchain.address.listunspent', [address]);
  }

  async estimateFee(blocks: number = 1): Promise<number> {
    if (!this.electrumClient) {
      throw new Error('Not connected. Call connect() first.');
    }
    const feeRate = await this.electrumClient.request('blockchain.estimatefee', [blocks]);
    return feeRate > 0 ? feeRate : 0.00001; // Default to 1 sat/byte if estimation fails
  }

  async deploy(
    wallet: WalletConfig,
    options: DeployOptions
  ): Promise<DeploymentResult> {
    try {
      if (!this.electrumClient) {
        throw new Error('Not connected. Call connect() first.');
      }

      const radiantjs = await this.loadRadiantJs();
      
      // Create wallet from config
      let privateKey: any;
      if (wallet.privateKey) {
        privateKey = new radiantjs.PrivateKey(wallet.privateKey);
      } else if (wallet.mnemonic) {
        const mnemonic = new radiantjs.Mnemonic(wallet.mnemonic);
        const hdPrivateKey = mnemonic.toHDPrivateKey();
        const path = wallet.derivationPath || "m/44'/0'/0'/0/0";
        privateKey = hdPrivateKey.deriveChild(path).privateKey;
      } else {
        throw new Error('Either privateKey or mnemonic must be provided');
      }

      const address = privateKey.toAddress().toString();
      
      // Get UTXOs for funding
      const utxos = await this.getUtxos(address);
      if (utxos.length === 0) {
        return {
          success: false,
          error: `No UTXOs found for address ${address}. Please fund the wallet first.`,
        };
      }

      // Build deployment transaction
      const tx = new radiantjs.Transaction();
      
      // Add inputs from UTXOs
      let totalInput = 0;
      for (const utxo of utxos) {
        tx.from({
          txId: utxo.tx_hash,
          outputIndex: utxo.tx_pos,
          script: radiantjs.Script.buildPublicKeyHashOut(privateKey.toAddress()),
          satoshis: utxo.value,
        });
        totalInput += utxo.value;
      }

      // Create contract output with bytecode
      const contractScript = radiantjs.Script.fromHex(options.artifact.bytecode);
      const contractValue = options.initialBalance || 546; // Minimum dust
      tx.addOutput(new radiantjs.Transaction.Output({
        script: contractScript,
        satoshis: contractValue,
      }));

      // Estimate fee
      const feeRate = options.feeRate || await this.estimateFee();
      const estimatedSize = tx.toBuffer().length + 100; // Add buffer for signatures
      const fee = Math.ceil(estimatedSize * feeRate * 100000000);

      // Add change output
      const change = totalInput - contractValue - fee;
      if (change > 546) {
        tx.change(privateKey.toAddress());
      }

      // Sign transaction
      tx.sign(privateKey);

      // Broadcast
      const txHex = tx.serialize();
      const txid = await this.electrumClient.request('blockchain.transaction.broadcast', [txHex]);

      // Calculate contract address (P2SH of contract script)
      const contractAddress = radiantjs.Address.fromScript(contractScript, this.config.network).toString();

      return {
        success: true,
        txid,
        contractAddress,
        fee,
        gasUsed: tx.toBuffer().length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  async compileAndDeploy(
    wallet: WalletConfig,
    sourceCode: string,
    constructorArgs: (string | number | Buffer)[] = [],
    options: { initialBalance?: number; feeRate?: number } = {}
  ): Promise<DeploymentResult> {
    try {
      // Dynamic import of compiler
      const { compileString } = await import('rxdc');
      const artifact = compileString(sourceCode) as unknown as ContractArtifact;

      return await this.deploy(wallet, {
        artifact,
        constructorArgs,
        ...options,
      });
    } catch (error: any) {
      return {
        success: false,
        error: `Compilation failed: ${error.message || String(error)}`,
      };
    }
  }

  private async loadRadiantJs(): Promise<any> {
    if (!this.radiantjs) {
      this.radiantjs = await import('@radiantblockchain/radiantjs');
    }
    return this.radiantjs;
  }

  getNetwork(): string {
    return this.config.network;
  }

  getElectrumUrl(): string {
    return `${this.config.electrumProtocol}://${this.config.electrumHost}:${this.config.electrumPort}`;
  }
}
