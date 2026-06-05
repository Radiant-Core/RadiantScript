import { Utxo, Network } from '../interfaces.js';
import NetworkProvider from './NetworkProvider.js';
import { validateUtxo } from '../utils.js';

export default class BitboxNetworkProvider implements NetworkProvider {
  constructor(
    public network: Network,
    private bitbox: BITBOX,
  ) {}

  async getUtxos(address: string): Promise<Utxo[]> {
    const { utxos } = await this.bitbox.Address.utxo(address);
    // Providers are untrusted — normalise to the Utxo shape and validate each
    // one before returning it (M-4).
    return utxos.map((utxo) => validateUtxo({
      txid: utxo.txid,
      vout: utxo.vout,
      satoshis: utxo.satoshis,
    }));
  }

  async getBlockHeight(): Promise<number> {
    return this.bitbox.Blockchain.getBlockCount();
  }

  async getRawTransaction(txid: string): Promise<string> {
    return this.bitbox.RawTransactions.getRawTransaction(txid);
  }

  async sendRawTransaction(txHex: string): Promise<string> {
    return this.bitbox.RawTransactions.sendRawTransaction(txHex);
  }
}

interface BITBOX {
  Address: {
    utxo(address: string): Promise<{ utxos: Utxo[] }>;
  };
  Blockchain: {
    getBlockCount(): Promise<number>;
  };
  RawTransactions: {
    getRawTransaction(txid: string): Promise<string>;
    sendRawTransaction(txHex: string): Promise<string>;
  };
}
