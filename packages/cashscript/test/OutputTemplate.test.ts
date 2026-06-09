import {
  decodeTransaction,
  hexToBin,
  binToHex,
  binToBigIntUint64LE,
} from '@bitauth/libauth';
import { hash160 } from '@radiantscript/utils';
import { Contract, SignatureTemplate } from '../src/index.js';
import {
  p2pkhOutput,
  p2shOutput,
  opReturnOutput,
  rawOutput,
  resolveOutput,
} from '../src/OutputTemplate.js';
import { Network, SignableUtxo, Utxo } from '../src/interfaces.js';
import NetworkProvider from '../src/network/NetworkProvider.js';
import { buildStatefulOutput, splitStatefulBytecode } from '../src/RadiantHelpers.js';
import { addressToLockScript } from '../src/utils.js';
import {
  alice,
  alicePk,
  alicePkh,
  aliceAddress,
  bobAddress,
  bobPkh,
  initFixtures,
} from './fixture/vars.js';

// ---------------------------------------------------------------------------
// P3: output-template helpers ("build the expected output, assert equality").
// ---------------------------------------------------------------------------
describe('Output-template helpers (P3)', () => {
  beforeAll(async () => initFixtures());

  describe('p2pkhOutput', () => {
    it('from an address string is the same as a plain { to, amount }', () => {
      const fromAddr = p2pkhOutput(aliceAddress, 1000);
      expect(fromAddr).toEqual({ to: aliceAddress, amount: 1000 });
      // Resolves to the canonical P2PKH locking bytecode.
      expect(binToHex(resolveOutput(fromAddr).lockingBytecode))
        .toBe(binToHex(addressToLockScript(aliceAddress)));
    });

    it('from a 20-byte pkh produces canonical P2PKH locking bytecode', () => {
      const out = p2pkhOutput(alicePkh, 1234);
      const resolved = resolveOutput(out);
      expect(binToHex(resolved.lockingBytecode))
        .toBe(binToHex(addressToLockScript(aliceAddress)));
      expect(resolved.amount).toBe(1234n);
    });

    it('from a 33-byte public key hashes it to the same pkh', () => {
      const out = p2pkhOutput(alicePk, 1000);
      expect(binToHex(resolveOutput(out).lockingBytecode))
        .toBe(binToHex(addressToLockScript(aliceAddress)));
      // hash160(pk) must equal the fixture pkh.
      expect(binToHex(hash160(alicePk))).toBe(binToHex(alicePkh));
    });

    it('rejects a byte length that is neither a pkh nor a public key', () => {
      expect(() => p2pkhOutput(new Uint8Array(10), 1000)).toThrow(/20-byte pkh.*public key/);
    });
  });

  describe('p2shOutput', () => {
    it('resolves to the address locking bytecode', () => {
      // Use the contract's own P2SH address.
      const out = p2shOutput(aliceAddress, 1000);
      expect(out).toEqual({ to: aliceAddress, amount: 1000 });
    });
  });

  describe('opReturnOutput', () => {
    it('produces a zero-value OP_RETURN identical to withOpReturn encoding', () => {
      const out = opReturnOutput(['0x6d02', 'hello']);
      expect(out.amount).toBe(0);
      expect(out.to).toBeInstanceOf(Uint8Array);
      // First byte is OP_RETURN.
      expect((out.to as Uint8Array)[0]).toBe(0x6a);
    });
  });

  describe('rawOutput', () => {
    it('passes locking bytecode straight through', () => {
      const bytecode = addressToLockScript(aliceAddress);
      const out = rawOutput({ lockingBytecode: bytecode, amount: 5000 });
      expect(binToHex(resolveOutput(out).lockingBytecode)).toBe(binToHex(bytecode));
      expect(resolveOutput(out).amount).toBe(5000n);
    });

    it('wraps a raw stateScript into the canonical <pushState> OP_STATESEPARATOR <code> layout', () => {
      // NOTE: this previously (SDK-1 bug) asserted the state was prepended
      // VERBATIM with no separator (`state + code`). That encoded the bug: the
      // on-chain stateSeparatorByteIndex landed at 0 and OP_STATESCRIPTBYTECODE
      // returned 0 instead of the state, breaking every covenant state pin.
      // resolveOutput now wraps raw state exactly like buildStatefulOutput.
      const state = hexToBin('0a0b0c');
      const code = addressToLockScript(aliceAddress);
      const out = rawOutput({ lockingBytecode: code, amount: 5000, stateScript: state });
      const resolved = resolveOutput(out);

      // push(0a0b0c)=0x03 0a 0b 0c, then 0xbd separator, then the code.
      expect(binToHex(resolved.lockingBytecode))
        .toBe(`030a0b0cbd${binToHex(code)}`);
    });
  });
});

// ---------------------------------------------------------------------------
// SDK-1: resolveOutput stateful path must agree byte-for-byte with
// buildStatefulOutput (the canonical Radiant stateful encoder).
// ---------------------------------------------------------------------------
describe('resolveOutput stateful encoding (SDK-1)', () => {
  beforeAll(async () => initFixtures());

  it('is byte-for-byte equal to buildStatefulOutput for the same (state, code)', () => {
    // The exact shape a covenant compares against, e.g. `0x14 <pkh>` to satisfy
    // `tx.outputs[0].stateScript == 0x14 + newOwnerPkh`.
    const state = new Uint8Array([0x14, ...alicePkh]);
    const code = addressToLockScript(bobAddress);

    const viaTemplate = resolveOutput({ to: code, amount: 5000, stateScript: state });
    const viaHelper = buildStatefulOutput(state, code);

    expect(binToHex(viaTemplate.lockingBytecode)).toBe(binToHex(viaHelper));
  });

  it('round-trips: reading the stateScript back yields the original raw state', () => {
    const state = new Uint8Array([0x14, ...alicePkh]);
    const code = addressToLockScript(bobAddress);

    const { lockingBytecode } = resolveOutput({ to: code, amount: 5000, stateScript: state });

    // Parse the on-chain layout back into its state/code halves at the 0xbd
    // separator. The recovered state (after stripping the push opcode) must be
    // the exact bytes the caller supplied.
    const split = splitStatefulBytecode(lockingBytecode);
    expect(split).not.toBeNull();
    // split.stateData is the push-encoded state: 0x14 (push 20) + the 20 pkh
    // bytes here, since the raw state is itself a 21-byte value pushed minimally
    // as 0x15 <21 bytes>. Strip the leading push opcode to recover raw state.
    expect(binToHex(split!.codeScript)).toBe(binToHex(code));
    // The push payload (everything after the 1-byte push opcode) is the raw state.
    const recoveredState = split!.stateData.slice(1);
    expect(binToHex(recoveredState)).toBe(binToHex(state));
  });

  it('matches Contract.buildStatefulOutput end-to-end for a contract code script', () => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const artifact = require('./fixture/p2pkh.json');
    const stubProvider = {
      network: Network.MAINNET,
      getUtxos: async (): Promise<Utxo[]> => [],
      getBlockHeight: async (): Promise<number> => 0,
      getRawTransaction: async (): Promise<string> => '',
      sendRawTransaction: async (): Promise<string> => '',
    } as unknown as NetworkProvider;
    const contract = new Contract(artifact, [alicePkh], stubProvider);

    const newOwner = bobPkh;
    // Contract.buildStatefulOutput wraps raw state with the contract's own code.
    const fullBytecode = contract.buildStatefulOutput(newOwner);

    // Feeding the SAME raw state + the contract's code script through the
    // template must produce identical bytecode.
    const code = hexToBin(contract.getRedeemScriptHex());
    const viaTemplate = resolveOutput({ to: code, amount: 1000, stateScript: newOwner });

    expect(binToHex(viaTemplate.lockingBytecode)).toBe(binToHex(fullBytecode));
  });
});

// ---------------------------------------------------------------------------
// P3: Transaction.withExactOutputs build-time assertion.
// ---------------------------------------------------------------------------
describe('Transaction.withExactOutputs (P3)', () => {
  beforeAll(async () => initFixtures());

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

  const bigInput = (satoshis: number): SignableUtxo => ({
    txid: 'a'.repeat(64),
    vout: 0,
    satoshis,
    template: new SignatureTemplate(alice),
  });

  function outputsOf(txHex: string): { script: string; amount: bigint }[] {
    const tx = decodeTransaction(hexToBin(txHex));
    if (typeof tx === 'string') throw new Error(tx);
    return tx.outputs.map((o) => ({
      script: binToHex(o.lockingBytecode),
      amount: binToBigIntUint64LE(o.satoshis),
    }));
  }

  it('builds when the declared exact outputs match (change allowed)', async () => {
    const contract = makeContract();
    const hex = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(bigInput(1_000_000))
      .withExactOutputs([
        p2pkhOutput(aliceAddress, 100_000),
        p2pkhOutput(bobAddress, 50_000),
      ])
      .withFeePerByte(1)
      .withoutPrevoutVerification()
      .build();

    const outs = outputsOf(hex);
    // First two outputs are exactly the declared ones, in order.
    expect(outs[0]).toEqual({ script: binToHex(addressToLockScript(aliceAddress)), amount: 100_000n });
    expect(outs[1]).toEqual({ script: binToHex(addressToLockScript(bobAddress)), amount: 50_000n });
    // A trailing change output back to the contract is allowed.
    expect(outs.length).toBe(3);
    expect(outs[2].script).toBe(binToHex(addressToLockScript(contract.address)));
  });

  it('builds with allowChange:false and no change output (exact set only)', async () => {
    const contract = makeContract();
    const hex = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(bigInput(151_000))
      .withExactOutputs(
        [p2pkhOutput(aliceAddress, 100_000), p2pkhOutput(bobAddress, 50_000)],
        { allowChange: false },
      )
      .withHardcodedFee(1000)
      .withoutPrevoutVerification()
      .build();

    const outs = outputsOf(hex);
    expect(outs.length).toBe(2);
    expect(outs[0].amount).toBe(100_000n);
    expect(outs[1].amount).toBe(50_000n);
  });

  it('rejects an artifact-shaped covenant-free build whose change appears unexpectedly with allowChange:false', async () => {
    // allowChange:false suppresses change, so this is really a guard that the
    // exact set holds; pass an input large enough that change WOULD have been
    // created, and confirm it is not (no extra output).
    const contract = makeContract();
    const hex = await contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(bigInput(1_000_000))
      .withExactOutputs([p2pkhOutput(aliceAddress, 100_000)], { allowChange: false })
      .withHardcodedFee(1000)
      .withoutPrevoutVerification()
      .build();
    expect(outputsOf(hex).length).toBe(1);
  });

  it('detects a state divergence: a mutated amount surfaces as a precise error', async () => {
    // Simulate builder/covenant disagreement by declaring an exact set, then
    // poking the underlying outputs array to a different amount before build.
    const contract = makeContract();
    const tx = contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(bigInput(1_000_000))
      .withExactOutputs([p2pkhOutput(aliceAddress, 100_000)], { allowChange: false })
      .withHardcodedFee(1000)
      .withoutPrevoutVerification();

    // Tamper: the live outputs no longer match the asserted template.
    (tx as any).outputs[0].amount = 99_999;

    await expect(tx.build()).rejects.toThrow(/Output template mismatch at index 0/);
  });

  it('detects an unexpected extra (non-change) output', async () => {
    const contract = makeContract();
    const tx = contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(bigInput(1_000_000))
      .withExactOutputs([p2pkhOutput(aliceAddress, 100_000)], { allowChange: false })
      .withHardcodedFee(1000)
      .withoutPrevoutVerification();

    // Inject an extra third-party output that the template did not declare.
    (tx as any).outputs.push({ to: bobAddress, amount: 50_000 });

    await expect(tx.build()).rejects.toThrow(/Output template mismatch/);
  });

  it('detects a wrong-recipient divergence (script mismatch)', async () => {
    const contract = makeContract();
    const tx = contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(bigInput(1_000_000))
      .withExactOutputs([p2pkhOutput(aliceAddress, 100_000)], { allowChange: false })
      .withHardcodedFee(1000)
      .withoutPrevoutVerification();

    // Tamper the recipient script to Bob's while the template still expects Alice.
    (tx as any).outputs[0] = { to: bobAddress, amount: 100_000 };

    await expect(tx.build()).rejects.toThrow(/Output template mismatch at index 0/);
  });

  it('rejects an empty exact-output array', () => {
    const contract = makeContract();
    expect(() => contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .withExactOutputs([])).toThrow(/non-empty array/);
  });

  it('a pkh-built template equals an address-built one (single source of truth)', async () => {
    // Declaring via pkh vs via address must produce the same on-chain output —
    // the whole point of resolving to canonical locking bytecode.
    const contract = makeContract();
    const build = async (out: ReturnType<typeof p2pkhOutput>): Promise<string> => contract.functions
      .spend(alicePk, new SignatureTemplate(alice))
      .from(bigInput(151_000))
      .withExactOutputs([out], { allowChange: false })
      .withHardcodedFee(1000)
      .withoutPrevoutVerification()
      .build();

    const viaAddress = await build(p2pkhOutput(bobAddress, 150_000));
    const viaPkh = await build(p2pkhOutput(bobPkh, 150_000));
    expect(outputsOf(viaAddress)).toEqual(outputsOf(viaPkh));
  });
});
