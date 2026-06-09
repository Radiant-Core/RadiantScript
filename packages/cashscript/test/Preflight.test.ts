import {
  bigIntToBinUint64LE,
  hexToBin,
  binToHex,
  encodeTransaction,
} from '@bitauth/libauth';
import { hash256 } from '@radiantscript/utils';
import { Contract, SignatureTemplate } from '../src/index.js';
import { p2pkhOutput } from '../src/OutputTemplate.js';
import { Network, SignableUtxo, Utxo } from '../src/interfaces.js';
import NetworkProvider from '../src/network/NetworkProvider.js';
import { addressToLockScript } from '../src/utils.js';
import {
  alice,
  alicePk,
  alicePkh,
  aliceAddress,
  initFixtures,
} from './fixture/vars.js';

// ---------------------------------------------------------------------------
// P4: bounded pre-broadcast pre-flight. NOT a consensus VM — these tests cover
// the structural checks (dust, fee bounds, counts, conservation), the optional
// provider mempool hook, and the send({ preflight: true }) wiring.
// ---------------------------------------------------------------------------
describe('Transaction.preflight (P4)', () => {
  beforeAll(async () => initFixtures());

  // eslint-disable-next-line global-require
  const artifact = (): any => require('./fixture/p2pkh.json');

  // A provider that authenticates the input's source tx so default-on prevout
  // verification passes during build(). Optionally exposes testMempoolAccept.
  function makeSourceTx(lockingBytecode: Uint8Array, satoshis: number): { hex: string; txid: string } {
    const tx = {
      version: 2,
      locktime: 0,
      inputs: [{
        outpointTransactionHash: new Uint8Array(32),
        outpointIndex: 0xffffffff,
        sequenceNumber: 0xffffffff,
        unlockingBytecode: hexToBin('00'),
      }],
      outputs: [{ lockingBytecode, satoshis: bigIntToBinUint64LE(BigInt(satoshis)) }],
    };
    const bytes = encodeTransaction(tx as any);
    return { hex: binToHex(bytes), txid: binToHex(hash256(bytes).reverse()) };
  }

  function provider(opts?: {
    map?: Record<string, string>;
    testMempoolAccept?: (txHex: string) => Promise<{ accepted: boolean; reason?: string }>;
  }): NetworkProvider {
    const base: any = {
      network: Network.MAINNET,
      getUtxos: async (): Promise<Utxo[]> => [],
      getBlockHeight: async (): Promise<number> => 0,
      getRawTransaction: async (txid: string): Promise<string> => {
        const hex = opts?.map?.[txid];
        if (hex === undefined) throw new Error(`no such tx ${txid}`);
        return hex;
      },
      sendRawTransaction: async (): Promise<string> => 'a'.repeat(64),
    };
    if (opts?.testMempoolAccept) base.testMempoolAccept = opts.testMempoolAccept;
    return base as NetworkProvider;
  }

  const INPUT_SATS = 1_000_000;
  const aliceScript = (): Uint8Array => addressToLockScript(aliceAddress);

  it('reports ok:true with a sane summary for a healthy transaction', async () => {
    const src = makeSourceTx(aliceScript(), INPUT_SATS);
    const prov = provider({ map: { [src.txid]: src.hex } });
    const contract = new Contract(artifact(), [alicePkh], prov);
    const input: SignableUtxo = {
      txid: src.txid, vout: 0, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
    };

    const report = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(input)
      .to(aliceAddress, 100_000)
      .withFeePerByte(1)
      .preflight();

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.summary.inputCount).toBe(1);
    expect(report.summary.totalIn).toBe(BigInt(INPUT_SATS));
    // Conservation: inputs == outputs + fee.
    expect(report.summary.totalIn).toBe(report.summary.totalOut + report.summary.fee);
    expect(report.summary.fee).toBeGreaterThanOrEqual(0n);
    expect(report.summary.txHex).toMatch(/^[0-9a-f]+$/);
  });

  it('flags a fee above MAX_FEE_SATOSHIS as an error', async () => {
    // Hardcode a fee at the maximum then make inputs exceed outputs by more than
    // MAX_FEE_SATOSHIS by under-paying outputs relative to a large input.
    // withHardcodedFee caps at MAX_FEE_SATOSHIS, so instead drive the fee via a
    // large input and small output with withoutChange + a hardcoded fee equal to
    // the gap, which is > MAX_FEE. Easiest: use withoutPrevoutVerification and a
    // huge input with a tiny output and withoutChange so fee = input - output.
    const contract = new Contract(artifact(), [alicePkh], provider());
    const input: SignableUtxo = {
      txid: 'a'.repeat(64), vout: 0, satoshis: 5_000_000, template: new SignatureTemplate(alice),
    };
    const report = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(input)
      .to(aliceAddress, 1000)
      .withHardcodedFee(0) // declared 0, but withoutChange leaves the rest as implied fee
      .withoutChange()
      .withoutPrevoutVerification()
      .preflight();

    // Implied fee = 5_000_000 - 1000 = 4_999_000 > MAX_FEE_SATOSHIS (1_000_000).
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/exceeds MAX_FEE_SATOSHIS/);
  });

  it('flags an implausibly high fee-per-byte as an error', async () => {
    // input - output spread across a small tx => very high sat/byte, but keep
    // the absolute fee under MAX_FEE so we isolate the per-byte check.
    const contract = new Contract(artifact(), [alicePkh], provider());
    const input: SignableUtxo = {
      txid: 'a'.repeat(64), vout: 0, satoshis: 900_000, template: new SignatureTemplate(alice),
    };
    const report = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(input)
      .to(aliceAddress, 1000) // fee ≈ 899_000 over ~200 bytes ⇒ thousands of sat/B
      .withHardcodedFee(0)
      .withoutChange()
      .withoutPrevoutVerification()
      .preflight();

    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/fee-per-byte .* implausibly high/);
  });

  it('warns (non-fatal) on an unusually high but in-bounds fee-per-byte', async () => {
    // Fee ≈ 30_000 over ~200 bytes ⇒ ~150 sat/B: above WARN(100), below MAX and
    // below the fee ceiling.
    const contract = new Contract(artifact(), [alicePkh], provider());
    const input: SignableUtxo = {
      txid: 'a'.repeat(64), vout: 0, satoshis: 130_000, template: new SignatureTemplate(alice),
    };
    const report = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(input)
      .to(aliceAddress, 100_000)
      .withHardcodedFee(0)
      .withoutChange()
      .withoutPrevoutVerification()
      .preflight();

    expect(report.ok).toBe(true);
    expect(report.warnings.join('\n')).toMatch(/unusually high/);
  });

  it('calls an optional provider testMempoolAccept and records acceptance', async () => {
    const src = makeSourceTx(aliceScript(), INPUT_SATS);
    let calledWith: string | undefined;
    const prov = provider({
      map: { [src.txid]: src.hex },
      testMempoolAccept: async (txHex: string) => {
        calledWith = txHex;
        return { accepted: true };
      },
    });
    const contract = new Contract(artifact(), [alicePkh], prov);
    const input: SignableUtxo = {
      txid: src.txid, vout: 0, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
    };
    const report = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(input)
      .to(aliceAddress, 100_000)
      .withFeePerByte(1)
      .preflight();

    expect(report.mempoolAccept).toEqual({ accepted: true });
    expect(calledWith).toBe(report.summary.txHex);
    expect(report.ok).toBe(true);
  });

  it('surfaces a provider mempool rejection as an error', async () => {
    const src = makeSourceTx(aliceScript(), INPUT_SATS);
    const prov = provider({
      map: { [src.txid]: src.hex },
      testMempoolAccept: async () => ({ accepted: false, reason: 'covenant-failed' }),
    });
    const contract = new Contract(artifact(), [alicePkh], prov);
    const input: SignableUtxo = {
      txid: src.txid, vout: 0, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
    };
    const report = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(input)
      .to(aliceAddress, 100_000)
      .withFeePerByte(1)
      .preflight();

    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/mempool test rejected.*covenant-failed/);
  });

  it('does not call a mempool hook the provider does not implement', async () => {
    const src = makeSourceTx(aliceScript(), INPUT_SATS);
    const prov = provider({ map: { [src.txid]: src.hex } });
    const contract = new Contract(artifact(), [alicePkh], prov);
    const input: SignableUtxo = {
      txid: src.txid, vout: 0, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
    };
    const report = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(input)
      .to(aliceAddress, 100_000)
      .withFeePerByte(1)
      .preflight();

    expect(report.mempoolAccept).toBeUndefined();
    expect(report.ok).toBe(true);
  });

  it('passes through the P3 exact-output template assertion', async () => {
    const contract = new Contract(artifact(), [alicePkh], provider());
    const input: SignableUtxo = {
      txid: 'a'.repeat(64), vout: 0, satoshis: 1_000_000, template: new SignatureTemplate(alice),
    };
    const report = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(input)
      .withExactOutputs([p2pkhOutput(aliceAddress, 100_000)])
      .withFeePerByte(1)
      .withoutPrevoutVerification()
      .preflight();
    expect(report.ok).toBe(true);
  });

  // send({ preflight: true }) must build exactly once (no double change output)
  // and abort on a failing preflight.
  describe('send({ preflight: true }) wiring', () => {
    it('aborts the broadcast when preflight fails', async () => {
      let broadcast = false;
      const prov: any = {
        network: Network.MAINNET,
        getUtxos: async (): Promise<Utxo[]> => [],
        getBlockHeight: async (): Promise<number> => 0,
        getRawTransaction: async (): Promise<string> => '',
        sendRawTransaction: async (): Promise<string> => {
          broadcast = true;
          return 'a'.repeat(64);
        },
      };
      const contract = new Contract(artifact(), [alicePkh], prov as NetworkProvider);
      const input: SignableUtxo = {
        txid: 'a'.repeat(64), vout: 0, satoshis: 5_000_000, template: new SignatureTemplate(alice),
      };
      await expect(contract.functions
        .spend(alicePk, new SignatureTemplate(alice))
        .from(input)
        .to(aliceAddress, 1000)
        .withHardcodedFee(0)
        .withoutChange()
        .withoutPrevoutVerification()
        .send({ preflight: true })).rejects.toThrow(/Preflight failed/);
      expect(broadcast).toBe(false);
    });

    it('builds exactly once: no duplicate change output when preflight passes', async () => {
      // Make the full round-trip succeed so send() returns without reaching its
      // error path: the broadcast stub serves the very hex it was given back
      // under that hex's own display txid, so getTxDetails(raw:true) resolves on
      // the first poll. This lets us inspect the actual broadcast transaction.
      let sentHex: string | undefined;
      const src = makeSourceTx(aliceScript(), INPUT_SATS);
      const prov: any = {
        network: Network.MAINNET,
        getUtxos: async (): Promise<Utxo[]> => [],
        getBlockHeight: async (): Promise<number> => 0,
        getRawTransaction: async (txid: string): Promise<string> => {
          if (txid === src.txid) return src.hex;
          // Serve the broadcast tx back under its own computed txid.
          if (sentHex) {
            const sentTxid = binToHex(hash256(hexToBin(sentHex)).reverse());
            if (txid === sentTxid) return sentHex;
          }
          throw new Error(`tx not visible ${txid}`);
        },
        sendRawTransaction: async (hex: string): Promise<string> => {
          sentHex = hex;
          return binToHex(hash256(hexToBin(hex)).reverse());
        },
      };
      const contract = new Contract(artifact(), [alicePkh], prov as NetworkProvider);
      const input: SignableUtxo = {
        txid: src.txid, vout: 0, satoshis: INPUT_SATS, template: new SignatureTemplate(alice),
      };

      const returnedHex = await contract.functions
        .spend(alicePk, new SignatureTemplate(alice))
        .from(input)
        .to(aliceAddress, 100_000)
        .withFeePerByte(1)
        .send(true, { preflight: true });

      // The transaction was broadcast (built exactly once) with exactly one
      // P2SH change output back to the contract — not two (which a double
      // build() would have produced).
      expect(sentHex).toBeDefined();
      expect(returnedHex).toBe(sentHex);
      const { decodeTransaction } = require('@bitauth/libauth');
      const decoded = decodeTransaction(hexToBin(sentHex!));
      const changeScript = binToHex(addressToLockScript(contract.address));
      const changeOutputs = decoded.outputs.filter(
        (o: any) => binToHex(o.lockingBytecode) === changeScript,
      );
      expect(changeOutputs.length).toBe(1);
    });
  });
});
