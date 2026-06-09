import {
  decodeTransaction,
  hexToBin,
  binToHex,
  binToBigIntUint64LE,
  bigIntToBinUint64LE,
  encodeTransaction,
} from '@bitauth/libauth';
import { hash256 } from '@radiantscript/utils';
import { Transaction } from '../src/Transaction.js';
import { Contract, SignatureTemplate } from '../src/index.js';
import { HashType, Network, SignableUtxo, Utxo } from '../src/interfaces.js';
import NetworkProvider from '../src/network/NetworkProvider.js';
import { addressToLockScript } from '../src/utils.js';
import {
  alice,
  alicePk,
  alicePkh,
  aliceAddress,
  initFixtures,
} from './fixture/vars.js';

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

describe('Transaction.validateAmount (SatoshiAmount widening)', () => {
  // Reuse the polling-test plumbing — we only need a Transaction instance
  // whose private validateAmount we can call.
  const stubProvider = {
    network: Network.MAINNET,
    getUtxos: async (): Promise<Utxo[]> => [],
    getBlockHeight: async (): Promise<number> => 0,
    getRawTransaction: async (): Promise<string> => '',
    sendRawTransaction: async (): Promise<string> => '',
  } as const;

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

  const v = (amount: number | bigint): void => (makeTx() as any).validateAmount(amount);

  it('accepts a plain integer number', () => {
    expect(() => v(1000)).not.toThrow();
  });

  it('accepts a bigint at the protocol maximum (2^64 − 1)', () => {
    // Documented as MAX_SAFE_SATOSHIS in constants.ts. This value cannot be
    // expressed losslessly as a JS number, which is the whole point of the
    // SatoshiAmount widening.
    expect(() => v(0xFFFFFFFFFFFFFFFFn)).not.toThrow();
  });

  it('accepts a bigint above Number.MAX_SAFE_INTEGER', () => {
    expect(() => v(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).not.toThrow();
  });

  it('rejects a number that is not an integer', () => {
    expect(() => v(1.5)).toThrow(/integer/);
  });

  it('rejects a negative number', () => {
    expect(() => v(-1)).toThrow(/negative/);
  });

  it('rejects a negative bigint', () => {
    expect(() => v(-1n)).toThrow(/negative/);
  });

  it('rejects a number above Number.MAX_SAFE_INTEGER (forces caller to use bigint)', () => {
    expect(() => v(Number.MAX_SAFE_INTEGER + 1)).toThrow(/bigint/);
  });

  it('rejects a bigint above 2^64 − 1', () => {
    expect(() => v(0xFFFFFFFFFFFFFFFFn + 1n)).toThrow(/uint64/);
  });
});

// ---------------------------------------------------------------------------
// Security regression tests for the fee / change / signing fixes.
//
// These exercise the real `build()` path via a Contract backed by a stub
// provider, so the change-output amounts and signing guards are observed
// end-to-end rather than through private-method pokes.
// ---------------------------------------------------------------------------
describe('Transaction fee / change / signing fixes', () => {
  beforeAll(async () => initFixtures());

  // p2pkh artifact gives us a one-function contract whose single input we can
  // satisfy with a SignatureTemplate (the `spend(pk, sig)` ABI).
  // eslint-disable-next-line global-require
  const artifact = (): any => require('./fixture/p2pkh.json');

  const stubProvider = (): NetworkProvider => ({
    network: Network.MAINNET,
    getUtxos: async (): Promise<Utxo[]> => [],
    getBlockHeight: async (): Promise<number> => 0,
    getRawTransaction: async (): Promise<string> => '',
    sendRawTransaction: async (): Promise<string> => '',
  } as unknown as NetworkProvider);

  function makeContract(): Contract {
    return new Contract(artifact(), [alicePkh], stubProvider());
  }

  // The contract's own P2SH address receives the change output; the explicit
  // recipient is Alice's P2PKH address. Reading the change amount back out of a
  // built tx means matching the locking bytecode against the contract address.
  function changeAmount(txHex: string, contractAddress: string): bigint | undefined {
    const tx = decodeTransaction(hexToBin(txHex));
    if (typeof tx === 'string') throw new Error(tx);
    // The change output is the P2SH one paying back to the contract address.
    // P2SH locking bytecode is `a9 14 <20> 87`; recover address-bearing hash by
    // length+shape rather than re-deriving the address.
    const p2shOutputs = tx.outputs.filter((o) => o.lockingBytecode.length === 23
      && o.lockingBytecode[0] === 0xa9);
    // contractAddress is referenced for clarity; the single P2SH output is change.
    expect(contractAddress).toMatch(/^3/); // mainnet P2SH
    if (p2shOutputs.length === 0) return undefined;
    return binToBigIntUint64LE(p2shOutputs[0].satoshis);
  }

  const bigInput = (satoshis: number): SignableUtxo => ({
    txid: 'a'.repeat(64),
    vout: 0,
    satoshis,
    template: new SignatureTemplate(alice),
  });

  // H-4: the change-output cost must scale with feePerByte. The decisive signal
  // is that the change delta between two fee rates equals the *full* tx byte
  // size times the rate difference — a size that includes the 32-byte change
  // output. With the old flat-32 bug the change output is excluded from the
  // scaled fee basis, so the delta comes up exactly 32*(Δrate) short.
  it('H-4: change-output cost scales with feePerByte', async () => {
    const inputSats = 1_000_000;
    const recipientSats = 100_000;

    const build = async (fpb: number): Promise<{ change: bigint; size: number }> => {
      const contract = makeContract();
      const hex = await contract.functions
        .spend(alicePk, new SignatureTemplate(alice))
        .from(bigInput(inputSats))
        .to(aliceAddress, recipientSats)
        .withFeePerByte(fpb)
        .withoutPrevoutVerification()
        .build();
      const change = changeAmount(hex, contract.address);
      if (change === undefined) throw new Error('expected a change output');
      return { change, size: hexToBin(hex).length };
    };

    const r1 = await build(1);
    const r10 = await build(10);

    // The two builds have identical byte size B (only the change amount differs,
    // not its encoded length). The SDK's fee basis is B plus a small per-input
    // over-estimate, but crucially must include the 32-byte change output.
    // delta = ceil(B*10) − ceil(B*1) = feeBasis * 9.
    const delta = r1.change - r10.change;
    expect(delta % 9n).toBe(0n);
    const feeBasis = Number(delta) / 9;

    // Decisive check: the fee basis must cover the *entire* transaction
    // including the change output. The serialized tx (with change) is r1.size
    // bytes; the fee basis must be at least that large. The flat-32 bug yields
    // feeBasis = txSize − 32 (change output omitted), which is < r1.size.
    expect(feeBasis).toBeGreaterThanOrEqual(r1.size);
  });

  // M-2: an explicit withHardcodedFee(0) must yield a total fee of exactly 0 —
  // no per-input fee and no change-output deduction sneak back in.
  it('M-2: withHardcodedFee(0) produces a zero total fee', async () => {
    const inputSats = 1_000_000;
    const recipientSats = 100_000;
    const contract = makeContract();
    const hex = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(bigInput(inputSats))
      .to(aliceAddress, recipientSats)
      .withHardcodedFee(0)
      .withoutPrevoutVerification()
      .build();

    const tx = decodeTransaction(hexToBin(hex));
    if (typeof tx === 'string') throw new Error(tx);
    const outTotal = tx.outputs.reduce<bigint>(
      (acc, o) => acc + binToBigIntUint64LE(o.satoshis),
      0n,
    );
    // fee = inputs − outputs. With a hardcoded 0 fee, every input satoshi is
    // accounted for in the outputs (recipient + change), so fee is exactly 0.
    // Compare as strings so a mismatch serialises cleanly in the reporter.
    expect((BigInt(inputSats) - outTotal).toString()).toBe('0');
  });

  it('M-2: a positive hardcoded fee is honoured exactly', async () => {
    const inputSats = 1_000_000;
    const recipientSats = 100_000;
    const hardFee = 5000;
    const contract = makeContract();
    const hex = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(bigInput(inputSats))
      .to(aliceAddress, recipientSats)
      .withHardcodedFee(hardFee)
      .withoutPrevoutVerification()
      .build();

    const tx = decodeTransaction(hexToBin(hex));
    if (typeof tx === 'string') throw new Error(tx);
    const outTotal = tx.outputs.reduce<bigint>(
      (acc, o) => acc + binToBigIntUint64LE(o.satoshis),
      0n,
    );
    expect((BigInt(inputSats) - outTotal).toString()).toBe(String(hardFee));
  });

  // H-2: input satoshis from a provider/caller flow into the sighash, so they
  // must be range-validated at build() just like outputs.
  it('H-2: rejects an input with non-integer satoshis at build()', async () => {
    const contract = makeContract();
    const badInput = { ...bigInput(0), satoshis: 1.5 as any };
    await expect(
      contract.functions
        .spend(alicePk, new SignatureTemplate(alice))
        .from(badInput)
        .to(aliceAddress, 1000)
        .build(),
    ).rejects.toThrow(/integer/);
  });

  it('H-2: rejects an input with negative satoshis at build()', async () => {
    const contract = makeContract();
    const badInput = { ...bigInput(0), satoshis: -1 as any };
    await expect(
      contract.functions
        .spend(alicePk, new SignatureTemplate(alice))
        .from(badInput)
        .to(aliceAddress, 1000)
        .build(),
    ).rejects.toThrow(/negative/);
  });

  // M-5: a SIGHASH_SINGLE signer at an input index with no matching output
  // signs the zeroed output hash — reject it.
  it('M-5: SIGHASH_SINGLE signer with no corresponding output throws', async () => {
    const contract = makeContract();
    const singleTemplate = new SignatureTemplate(alice, HashType.SIGHASH_SINGLE);
    // Two inputs but only one output: input index 1 has no matching output →
    // SINGLE bug. `withoutChange()` suppresses the change output so exactly one
    // output remains.
    await expect(
      contract.functions
        .spend(alicePk, new SignatureTemplate(alice))
        .from([
          { txid: 'a'.repeat(64), vout: 0, satoshis: 100_000, template: new SignatureTemplate(alice) },
          { txid: 'b'.repeat(64), vout: 0, satoshis: 100_000, template: singleTemplate },
        ] as SignableUtxo[])
        .to(aliceAddress, 1000)
        .withHardcodedFee(1000)
        .withoutChange()
        .withoutPrevoutVerification()
        .build(),
    ).rejects.toThrow(/SIGHASH_SINGLE/);
  });

  // L-2 (was a guard, now removed): a covenant spend with multiple signature
  // args of DIFFERENT hash types is legitimate. Each covenant signature is
  // signed over its own per-arg sighash type and carries its own trailing
  // hashtype byte, so on-chain OP_CHECKSIG validates each one independently —
  // there is no shared on-stack preimage for them to disagree about (the
  // preimage-on-stack path was removed, P5). The old guard ("All covenant
  // signatures must use the same hash type") was stale + over-restrictive and
  // has been removed; this test now asserts the mixed-hashtype build SUCCEEDS.
  it('L-2: covenant signatures with differing hash types now build successfully', async () => {
    // Drive the covenant-arg path directly: a Transaction whose `args` carry
    // two SignatureTemplates with different hash types, spending a non-signable
    // input (so the args take the covenant signing branch). Reuse p2pkh's
    // redeem script and supply the args directly on a constructed Transaction.
    const { asmToScript } = require('@radiantscript/utils');
    const redeemScript = asmToScript('OP_OVER OP_HASH160 OP_EQUALVERIFY OP_CHECKSIG');
    const tx = new (Transaction as any)(
      aliceAddress,
      stubProvider(),
      redeemScript,
      { type: 'function', name: 'spend', inputs: [] },
      [
        new SignatureTemplate(alice, HashType.SIGHASH_ALL),
        new SignatureTemplate(alice, HashType.SIGHASH_NONE),
      ],
      undefined,
    ) as Transaction;

    const txHex = await tx
      .from({ txid: 'a'.repeat(64), vout: 0, satoshis: 100_000 })
      .to(aliceAddress, 1000)
      .withHardcodedFee(1000)
      .withoutPrevoutVerification()
      .build();

    // The build no longer throws; it produces a decodable transaction whose
    // single input's unlocking script carries BOTH signatures, each ending in
    // its own hashtype byte (0x41 = SIGHASH_ALL|forkid, 0x42 = SIGHASH_NONE|forkid).
    expect(typeof txHex).toBe('string');
    const decoded = decodeTransaction(hexToBin(txHex));
    if (typeof decoded === 'string') throw new Error(decoded);
    expect(decoded.inputs).toHaveLength(1);
    const unlockingHex = binToHex(decoded.inputs[0].unlockingBytecode);
    // Each Schnorr sig is 64 bytes + 1 hashtype byte; both hashtype bytes appear.
    expect(unlockingHex).toContain('41'); // SIGHASH_ALL | forkid
    expect(unlockingHex).toContain('42'); // SIGHASH_NONE | forkid
  });
});

// ---------------------------------------------------------------------------
// H-3: getTxDetails must verify the provider's hex hashes to the requested
// txid before trusting it.
// ---------------------------------------------------------------------------
describe('Transaction.getTxDetails txid verification (H-3)', () => {
  // Encode a minimal valid transaction so we have a real (hex, txid) pair.
  function makeRawTx(): { hex: string; txid: string } {
    const tx = {
      version: 2,
      locktime: 0,
      inputs: [{
        outpointTransactionHash: new Uint8Array(32),
        outpointIndex: 0xffffffff,
        sequenceNumber: 0xffffffff,
        unlockingBytecode: hexToBin('00'),
      }],
      outputs: [{ lockingBytecode: hexToBin('6a'), satoshis: hexToBin('0000000000000000') }],
    };
    const bytes = encodeTransaction(tx as any);
    const hex = binToHex(bytes);
    // Display txid = reverse(hash256(rawtx)).
    const txid = binToHex(hash256(bytes).reverse());
    return { hex, txid };
  }

  function makeTx(getRawTransaction: (txid: string) => Promise<string>): Transaction {
    const provider = {
      network: Network.MAINNET,
      getUtxos: async (): Promise<Utxo[]> => [],
      getBlockHeight: async (): Promise<number> => 0,
      getRawTransaction,
      sendRawTransaction: async (): Promise<string> => '',
    } as unknown as NetworkProvider;
    return new (Transaction as any)(
      'placeholder-address',
      provider,
      [],
      { type: 'function', name: 'noop', inputs: [] },
      [],
      undefined,
    );
  }

  it('returns details when the provider hex matches the requested txid', async () => {
    const { hex, txid } = makeRawTx();
    const tx = makeTx(async () => hex);
    const details = await (tx as any).getTxDetails(txid, undefined, undefined, 5);
    expect(details.txid).toBe(txid);
    expect(details.hex).toBe(hex);
  });

  it('throws when the provider returns hex for a different txid', async () => {
    const { hex } = makeRawTx();
    const wrongTxid = 'f'.repeat(64);
    const tx = makeTx(async () => hex);
    await expect(
      (tx as any).getTxDetails(wrongTxid, undefined, undefined, 5),
    ).rejects.toThrow(/Provider returned tx .* for requested/);
  });
});

// ---------------------------------------------------------------------------
// H-2 (full): prevout verification. Before signing, each input's source tx is
// fetched, authenticated (hash256 == txid), and its prevout value + locking
// script are asserted to match what is being signed. Because the source tx's
// txid is *derived* from its bytes, a provider cannot forge a source tx with
// altered values for an outpoint the spender already committed to.
// ---------------------------------------------------------------------------
describe('Transaction prevout verification (H-2 full)', () => {
  beforeAll(async () => initFixtures());

  // eslint-disable-next-line global-require
  const artifact = (): any => require('./fixture/p2pkh.json');

  // Build a real source transaction carrying a chosen output, and return its
  // hex plus the display txid it hashes to.
  function makeSourceTx(
    lockingBytecode: Uint8Array,
    satoshis: number,
    vout = 0,
  ): { hex: string; txid: string } {
    const outputs = [];
    for (let k = 0; k <= vout; k += 1) {
      outputs.push(k === vout
        ? { lockingBytecode, satoshis: bigIntToBinUint64LE(BigInt(satoshis)) }
        : { lockingBytecode: hexToBin('6a'), satoshis: bigIntToBinUint64LE(0n) });
    }
    const tx = {
      version: 2,
      locktime: 0,
      inputs: [{
        outpointTransactionHash: new Uint8Array(32),
        outpointIndex: 0xffffffff,
        sequenceNumber: 0xffffffff,
        unlockingBytecode: hexToBin('00'),
      }],
      outputs,
    };
    const bytes = encodeTransaction(tx as any);
    return { hex: binToHex(bytes), txid: binToHex(hash256(bytes).reverse()) };
  }

  // A provider that serves a fixed txid → hex map (throwing for anything else).
  function servingProvider(map: Record<string, string>): NetworkProvider {
    return {
      network: Network.MAINNET,
      getUtxos: async (): Promise<Utxo[]> => [],
      getBlockHeight: async (): Promise<number> => 0,
      getRawTransaction: async (txid: string): Promise<string> => {
        const hex = map[txid];
        if (hex === undefined) throw new Error(`no such tx ${txid}`);
        return hex;
      },
      sendRawTransaction: async (): Promise<string> => '',
    } as unknown as NetworkProvider;
  }

  const INPUT_SATS = 1_000_000;
  // The signable input is spent as P2PKH(alice), so its authentic prevout
  // script is Alice's P2PKH locking bytecode.
  const aliceScript = (): Uint8Array => addressToLockScript(aliceAddress);

  function buildSpend(provider: NetworkProvider, input: SignableUtxo): Promise<string> {
    const contract = new Contract(artifact(), [alicePkh], provider);
    return contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(input)
      .to(aliceAddress, 100_000)
      .withHardcodedFee(1000)
      .build();
  }

  it('accepts an input whose authenticated prevout matches value and script', async () => {
    const src = makeSourceTx(aliceScript(), INPUT_SATS, 0);
    const input: SignableUtxo = {
      txid: src.txid, vout: 0, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
    };
    await expect(buildSpend(servingProvider({ [src.txid]: src.hex }), input))
      .resolves.toMatch(/^[0-9a-f]+$/);
  });

  it('rejects when the prevout value differs from the input satoshis', async () => {
    // Source output holds a DIFFERENT value than the input claims.
    const src = makeSourceTx(aliceScript(), INPUT_SATS + 1, 0);
    const input: SignableUtxo = {
      txid: src.txid, vout: 0, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
    };
    await expect(buildSpend(servingProvider({ [src.txid]: src.hex }), input))
      .rejects.toThrow(/mismatched input amount/);
  });

  it('rejects when the prevout script is not the one being spent', async () => {
    // Source output pays a P2SH script, but the input is signed as Alice P2PKH.
    const wrongScript = hexToBin(`a914${'00'.repeat(20)}87`);
    const src = makeSourceTx(wrongScript, INPUT_SATS, 0);
    const input: SignableUtxo = {
      txid: src.txid, vout: 0, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
    };
    await expect(buildSpend(servingProvider({ [src.txid]: src.hex }), input))
      .rejects.toThrow(/does not belong to the address being spent/);
  });

  it('rejects when the provider serves a tx that does not hash to the requested txid', async () => {
    const src = makeSourceTx(aliceScript(), INPUT_SATS, 0);
    const wrongTxid = 'd'.repeat(64);
    const input: SignableUtxo = {
      txid: wrongTxid, vout: 0, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
    };
    await expect(buildSpend(servingProvider({ [wrongTxid]: src.hex }), input))
      .rejects.toThrow(/provider returned transaction/);
  });

  it('rejects when the referenced output index does not exist', async () => {
    const src = makeSourceTx(aliceScript(), INPUT_SATS, 0); // only vout 0 exists
    const input: SignableUtxo = {
      txid: src.txid, vout: 5, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
    };
    await expect(buildSpend(servingProvider({ [src.txid]: src.hex }), input))
      .rejects.toThrow(/output\(s\)/);
  });

  it('rejects when the source transaction cannot be fetched', async () => {
    const input: SignableUtxo = {
      txid: 'e'.repeat(64), vout: 0, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
    };
    await expect(buildSpend(servingProvider({}), input))
      .rejects.toThrow(/could not fetch source transaction/);
  });

  it('withoutPrevoutVerification() skips the check (builds against an empty provider)', async () => {
    const contract = new Contract(artifact(), [alicePkh], servingProvider({}));
    const input: SignableUtxo = {
      txid: 'a'.repeat(64), vout: 0, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
    };
    const hex = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(input)
      .to(aliceAddress, 100_000)
      .withHardcodedFee(1000)
      .withoutPrevoutVerification()
      .build();
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });
});

// ---------------------------------------------------------------------------
// H-2: satoshi values committed to the sighash must lie in Radiant's consensus
// money range [0, MAX_MONEY] (2.1e18 photons; see constants.ts).
// ---------------------------------------------------------------------------
describe('Transaction.assertMoneyRange (H-2)', () => {
  const stubProvider = {
    network: Network.MAINNET,
    getUtxos: async (): Promise<Utxo[]> => [],
    getBlockHeight: async (): Promise<number> => 0,
    getRawTransaction: async (): Promise<string> => '',
    sendRawTransaction: async (): Promise<string> => '',
  } as const;

  function makeTx(): Transaction {
    return new (Transaction as any)(
      'addr', stubProvider, [], { type: 'function', name: 'noop', inputs: [] }, [], undefined,
    );
  }
  const r = (sats: number): void => (makeTx() as any).assertMoneyRange(sats, 0);

  it('accepts MAX_MONEY exactly (2,100,000,000,000,000,000 photons)', () => {
    expect(() => r(2_100_000_000_000_000_000)).not.toThrow();
  });

  it('rejects a value above MAX_MONEY', () => {
    // Next representable float above 2.1e18 (mantissa spacing 512) exceeds it.
    expect(() => r(2_100_000_000_000_000_512)).toThrow(/MAX_MONEY/);
  });

  it('rejects a negative value', () => {
    expect(() => r(-1)).toThrow(/non-integer or negative/);
  });

  it('rejects a non-integer value', () => {
    expect(() => r(1.5)).toThrow(/non-integer or negative/);
  });
});
