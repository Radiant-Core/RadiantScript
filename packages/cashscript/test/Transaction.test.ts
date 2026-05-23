import { Transaction } from '../src/Transaction.js';
import { Network, Utxo } from '../src/interfaces.js';

/**
 * Unit tests for the polling-loop controls of {@link Transaction.send}.
 *
 * These exercise the private `getTxDetails` directly via a type cast, which is
 * sufficient because that is where the `AbortSignal` and `maxRetries` parameters
 * actually live — `send` is a thin wrapper that forwards them.
 */
describe('Transaction polling controls', () => {
  // Stub provider — only the methods touched by `getTxDetails` matter here.
  const stubProvider = {
    network: Network.MAINNET,
    getUtxos: async (): Promise<Utxo[]> => [],
    getBlockHeight: async (): Promise<number> => 0,
    getRawTransaction: async (): Promise<string> => {
      throw new Error('tx not yet visible');
    },
    sendRawTransaction: async (): Promise<string> => 'deadbeef',
  } as const;

  // Minimal Transaction stub — the polling path does not read any of these.
  function makeTx(): Transaction {
    return new (Transaction as any)(
      'placeholder-address',
      stubProvider,
      [],
      { type: 'function', name: 'noop', inputs: [] },
      [],
      undefined,
    );
  }

  it('throws when the AbortSignal is aborted before polling starts', async () => {
    const tx = makeTx();
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(
      (tx as any).getTxDetails('a'.repeat(64), undefined, ctrl.signal, 10),
    ).rejects.toThrow('getTxDetails aborted by caller');
  });

  it('throws when the AbortSignal is aborted mid-polling', async () => {
    const tx = makeTx();
    const ctrl = new AbortController();

    // Abort after one polling cycle (~500 ms). Use 50 ms here since the poll
    // sleeps before checking the signal; the first iteration's sleep ends and
    // the second iteration sees the abort.
    setTimeout(() => ctrl.abort(), 50);

    await expect(
      (tx as any).getTxDetails('b'.repeat(64), undefined, ctrl.signal, 10),
    ).rejects.toThrow('getTxDetails aborted by caller');
  });

  it('respects a small maxRetries cap', async () => {
    const tx = makeTx();
    // maxRetries=2 with the stub's always-failing provider should bail out
    // with the "over 10 minutes" message after exactly 2 cycles (≈ 1 s).
    await expect(
      (tx as any).getTxDetails('c'.repeat(64), undefined, undefined, 2),
    ).rejects.toThrow('Could not retrieve transaction details');
  }, 5_000);
});
