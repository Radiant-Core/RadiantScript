import { Contract } from '../src/index.js';
import { Network } from '../src/interfaces.js';

/**
 * Schema-validation tests for the Contract constructor. Lives in its own
 * file (not `Contract.test.ts`) so it has no dependency on `test/fixture/vars.ts`,
 * which transitively requires `bitbox-sdk` — a legacy dep not present in the
 * current install.
 *
 * Uses a hand-rolled stub provider rather than `new ElectrumNetworkProvider()`
 * to avoid pre-existing issues with the `electrum-cash` 2.x transport API.
 */
describe('Contract artifact schema validation', () => {
  // Minimal valid artifact under the *current* schema
  // (`packages/utils/src/artifact.ts`). The on-disk fixture
  // `./fixture/p2pkh.json` is in an older format and is not used here.
  const artifact = {
    contract: 'P2PKH',
    asm: 'OP_DUP OP_HASH160 OP_EQUALVERIFY OP_CHECKSIG',
    abi: [
      {
        type: 'constructor',
        params: [{ name: 'pkh', type: 'bytes20' }],
      },
      {
        type: 'function',
        name: 'spend',
        params: [
          { name: 'pk', type: 'pubkey' },
          { name: 's', type: 'sig' },
        ],
      },
    ],
  };
  const provider: any = {
    network: Network.MAINNET,
    getUtxos: async () => [],
    getBlockHeight: async () => 0,
    getRawTransaction: async () => { throw new Error('stub'); },
    sendRawTransaction: async () => { throw new Error('stub'); },
  };

  it('rejects non-object artifacts', () => {
    expect(() => new Contract(null as any, [], provider)).toThrow(/expected an object/);
    expect(() => new Contract('hello' as any, [], provider)).toThrow(/expected an object/);
  });

  it('rejects a non-string or empty "contract" field', () => {
    expect(() => new Contract({ ...artifact, contract: 123 } as any, [], provider))
      .toThrow(/"contract" must be a non-empty string/);
    expect(() => new Contract({ ...artifact, contract: '' } as any, [], provider))
      .toThrow(/"contract" must be a non-empty string/);
  });

  it('rejects a non-string "asm" field', () => {
    expect(() => new Contract({ ...artifact, asm: 42 } as any, [], provider))
      .toThrow(/"asm" must be a non-empty string/);
  });

  it('rejects a non-array "abi" field', () => {
    expect(() => new Contract({ ...artifact, abi: {} } as any, [], provider))
      .toThrow(/"abi" must be an array/);
  });

  it('rejects an abi entry with an unknown type', () => {
    expect(() => new Contract({
      ...artifact,
      abi: [{ type: 'bogus', params: [] }],
    } as any, [], provider)).toThrow(/'function' or 'constructor'/);
  });

  it('rejects an abi entry with non-array params', () => {
    expect(() => new Contract({
      ...artifact,
      abi: [{ type: 'constructor', params: 'no' }],
    } as any, [], provider)).toThrow(/\.params must be an array/);
  });

  it('rejects an abi param missing its type', () => {
    expect(() => new Contract({
      ...artifact,
      abi: [{ type: 'constructor', params: [{ name: 'x' }] }],
    } as any, [], provider)).toThrow(/\.type must be a string/);
  });

  it('rejects an abi with no constructor entry', () => {
    expect(() => new Contract({
      ...artifact,
      abi: [{ type: 'function', name: 'spend', params: [] }],
    } as any, [], provider)).toThrow(/missing a constructor entry/);
  });
});
