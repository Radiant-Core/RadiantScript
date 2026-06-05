import { Utxo, Network } from '../interfaces.js';
import NetworkProvider from './NetworkProvider.js';
import { validateUtxo } from '../utils.js';

const RpcClientRetry = require('bitcoin-rpc-promise-retry');

export default class BitcoinRpcNetworkProvider implements NetworkProvider {
  private rpcClient: RpcClientRetry;

  constructor(
    public network: Network,
    url: string,
    opts?: object,
  ) {
    this.rpcClient = new RpcClientRetry(url, opts);
  }

  async getUtxos(address: string): Promise<Utxo[]> {
    const result = await this.rpcClient.listUnspent(0, 9999999, [address]);

    // `amount` is RXD as a float; converting to satoshis via `* 1e8` yields a
    // non-integer for honest nodes (BigInt would throw downstream) and could be
    // negative/huge for a malicious one. Round to the nearest integer satoshi
    // and validate the result is a finite, non-negative integer (M-3); then run
    // the full UTXO validation (M-4).
    const utxos = result.map((utxo) => {
      const satoshis = Math.round(utxo.amount * 1e8);
      if (!Number.isFinite(satoshis) || satoshis < 0) {
        throw new Error(
          `Invalid UTXO ${utxo.txid}: amount ${utxo.amount} converts to invalid satoshis ${satoshis}`,
        );
      }
      return validateUtxo({
        txid: utxo.txid,
        vout: utxo.vout,
        satoshis,
      });
    });

    return utxos;
  }

  async getBlockHeight(): Promise<number> {
    return this.rpcClient.getBlockCount();
  }

  async getRawTransaction(txid: string): Promise<string> {
    return this.rpcClient.getRawTransaction(txid);
  }

  async sendRawTransaction(txHex: string): Promise<string> {
    return this.rpcClient.sendRawTransaction(txHex);
  }

  getClient(): RpcClientRetry {
    return this.rpcClient;
  }
}

interface ListUnspentItem {
  txid: string;
  vout: number;
  address: string;
  label: string;
  scriptPubKey: string;
  amount: number;
  confirmations: number;
  redeemScript: string;
  spendable: boolean;
  solvable: boolean;
  safe: boolean;
}

interface RpcClientRetry {
  constructor(url: string, opts?: object): void;
  listUnspent(
    minConf?: number,
    maxConf?: number,
    addresses?: string[],
    includeUnsafe?: boolean,
    queryOptions?: object,
  ): Promise<ListUnspentItem[]>;
  getBlockCount(): Promise<number>;
  getRawTransaction(txid: string, verbose?: boolean, blockHash?: string): Promise<string>;
  sendRawTransaction(hexString: string, allowHighFees?: boolean): Promise<string>;

  // below are not required for NetworkProvider interface, but very useful
  generate(nBlocks: number, maxTries?: number): Promise<string[]>;
  generateToAddress(nBlocks: number, address: string, maxTries?: number): Promise<string[]>;
  getNewAddress(label?: string): Promise<string>;
  dumpPrivKey(address: string): Promise<string>;
  getBalance(dummy?: string, minConf?: number, includeWatchOnly?: boolean): Promise<number>;
  getBlock(blockHash: string, verbosity?: number): Promise<string>;
  importAddress(address: string, label?: string, rescan?: boolean, p2sh?: boolean): Promise<void>;
}
