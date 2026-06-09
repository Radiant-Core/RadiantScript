import { Utxo, Network } from '../interfaces.js';

export default interface NetworkProvider {
  /**
   * Variable indicating the network that this provider connects to.
   */
  network: Network;

  /**
   * Retrieve all UTXOs (confirmed and unconfirmed) for a given address.
   * @param address The Radiant base58check address (P2PKH or P2SH) for which
   *                we wish to retrieve UTXOs. Radiant does not use cashaddr.
   * @returns List of UTXOs spendable by the provided address.
   */
  getUtxos(address: string): Promise<Utxo[]>;

  /**
   * @returns The current block height.
   */
  getBlockHeight(): Promise<number>;

  /**
   * Retrieve the Hex transaction details for a given transaction ID.
   * @param txid Hex transaction ID.
   * @throws {Error} If the transaction does not exist
   * @returns The full hex transaction for the provided transaction ID.
   */
  getRawTransaction(txid: string): Promise<string>;

  /**
   * Broadcast a raw hex transaction to the Bitcoin Cash network.
   * @param txHex The raw transaction hex to be broadcast.
   * @throws {Error} If the transaction was not accepted by the network.
   * @returns The transaction ID corresponding to the broadcast transaction.
   */
  sendRawTransaction(txHex: string): Promise<string>;

  /**
   * OPTIONAL. Ask the node whether a raw transaction would be accepted into the
   * mempool WITHOUT broadcasting it (the equivalent of Bitcoin's
   * `testmempoolaccept`). Providers that wrap an RPC node may implement this;
   * those that cannot (e.g. plain ElectrumX) omit it.
   *
   * When present, {@link Transaction.preflight} calls it as a best-effort extra
   * check. A reject result is surfaced in the preflight report. Note that this
   * runs the node's relay/policy + script checks, which CAN catch covenant
   * violations the off-chain structural checks cannot — but it is still an
   * optional convenience, not a guarantee that every provider offers.
   *
   * @param txHex The raw transaction hex to test.
   * @returns `{ accepted: true }` if the node would accept it, otherwise
   *          `{ accepted: false, reason }` with the node's rejection reason.
   */
  testMempoolAccept?(txHex: string): Promise<{ accepted: boolean; reason?: string }>;
}
