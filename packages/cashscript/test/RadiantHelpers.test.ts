import {
  encodeTokenRef,
  decodeTokenRef,
  buildStatefulOutput,
  encodePush,
  encodeScriptInt,
  splitStatefulBytecode,
} from '../src/RadiantHelpers.js';

const OP_STATESEPARATOR = 0xbd;

// ─── encodeTokenRef / decodeTokenRef ─────────────────────────────────────────

describe('encodeTokenRef', () => {
  it('produces 36 bytes for valid inputs', () => {
    const ref = encodeTokenRef('a'.repeat(64), 0);
    expect(ref.byteLength).toBe(36);
  });

  it('encodes vout in little-endian at bytes 32-35', () => {
    const ref = encodeTokenRef('00'.repeat(32), 1);
    expect(ref[32]).toBe(1);
    expect(ref[33]).toBe(0);
    expect(ref[34]).toBe(0);
    expect(ref[35]).toBe(0);
  });

  it('encodes vout=0x01020304 correctly (LE)', () => {
    const ref = encodeTokenRef('00'.repeat(32), 0x01020304);
    expect(ref[32]).toBe(0x04);
    expect(ref[33]).toBe(0x03);
    expect(ref[34]).toBe(0x02);
    expect(ref[35]).toBe(0x01);
  });

  it('throws for txid shorter than 64 chars', () => {
    expect(() => encodeTokenRef('abc', 0)).toThrow();
  });

  it('throws for negative vout', () => {
    expect(() => encodeTokenRef('a'.repeat(64), -1)).toThrow();
  });

  it('throws for vout > 0xFFFFFFFF', () => {
    expect(() => encodeTokenRef('a'.repeat(64), 0x100000000)).toThrow();
  });
});

describe('decodeTokenRef', () => {
  it('round-trips encodeTokenRef', () => {
    const txid = 'deadbeef'.repeat(8);
    const vout = 42;
    const ref = encodeTokenRef(txid, vout);
    const decoded = decodeTokenRef(ref);
    expect(decoded.txid).toBe(txid);
    expect(decoded.vout).toBe(vout);
  });

  it('throws for buffer not 36 bytes', () => {
    expect(() => decodeTokenRef(new Uint8Array(35))).toThrow();
    expect(() => decodeTokenRef(new Uint8Array(37))).toThrow();
  });
});

// ─── encodePush ──────────────────────────────────────────────────────────────

describe('encodePush', () => {
  it('uses single-byte length prefix for data < 76 bytes', () => {
    const data = new Uint8Array(10).fill(0xaa);
    const pushed = encodePush(data);
    expect(pushed[0]).toBe(10);
    expect(pushed.byteLength).toBe(11);
  });

  it('uses OP_PUSHDATA1 (0x4c) for data 76–255 bytes', () => {
    const data = new Uint8Array(100).fill(0xbb);
    const pushed = encodePush(data);
    expect(pushed[0]).toBe(0x4c);
    expect(pushed[1]).toBe(100);
    expect(pushed.byteLength).toBe(102);
  });

  it('uses OP_PUSHDATA2 (0x4d) for data 256–65535 bytes', () => {
    const data = new Uint8Array(300).fill(0xcc);
    const pushed = encodePush(data);
    expect(pushed[0]).toBe(0x4d);
    expect(pushed[1]).toBe(300 & 0xff);
    expect(pushed[2]).toBe((300 >> 8) & 0xff);
    expect(pushed.byteLength).toBe(303);
  });

  it('handles empty data with OP_PUSHDATA1 0x00', () => {
    const pushed = encodePush(new Uint8Array(0));
    expect(pushed[0]).toBe(0x4c);
    expect(pushed[1]).toBe(0x00);
    expect(pushed.byteLength).toBe(2);
  });
});

// ─── encodeScriptInt ─────────────────────────────────────────────────────────

describe('encodeScriptInt', () => {
  it('encodes 0 as empty bytes', () => {
    expect(encodeScriptInt(0).byteLength).toBe(0);
  });

  it('encodes 1 as [0x01]', () => {
    const b = encodeScriptInt(1);
    expect(b.byteLength).toBe(1);
    expect(b[0]).toBe(0x01);
  });

  it('encodes -1 as [0x81]', () => {
    const b = encodeScriptInt(-1);
    expect(b.byteLength).toBe(1);
    expect(b[0]).toBe(0x81);
  });

  it('encodes 128 as [0x80, 0x00]', () => {
    const b = encodeScriptInt(128);
    expect(b.byteLength).toBe(2);
    expect(b[0]).toBe(0x80);
    expect(b[1]).toBe(0x00);
  });

  it('throws for non-safe integer', () => {
    expect(() => encodeScriptInt(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});

// ─── buildStatefulOutput / splitStatefulBytecode ─────────────────────────────

describe('buildStatefulOutput + splitStatefulBytecode round-trip', () => {
  const stateData = new Uint8Array(20).fill(0x11);
  const codeScript = new Uint8Array([0x76, 0xa9, 0x14, 0x88, 0xac]);

  it('inserts OP_STATESEPARATOR between state and code', () => {
    const output = buildStatefulOutput(stateData, codeScript);
    const sepIdx = Array.from(output).findIndex((b, i) => {
      if (b !== OP_STATESEPARATOR) return false;
      return true;
    });
    expect(sepIdx).toBeGreaterThan(0);
    expect(output[sepIdx]).toBe(OP_STATESEPARATOR);
  });

  it('round-trips state data and code script', () => {
    const output = buildStatefulOutput(stateData, codeScript);
    const split = splitStatefulBytecode(output);
    expect(split).not.toBeNull();
    // stateData portion is inside a push, so extract the payload
    const rawState = split!.stateData.slice(split!.stateData.length - stateData.byteLength);
    expect(rawState).toEqual(stateData);
    expect(split!.codeScript).toEqual(codeScript);
  });
});

describe('splitStatefulBytecode', () => {
  it('returns null when no OP_STATESEPARATOR present', () => {
    const plain = new Uint8Array([0x76, 0xa9, 0x88, 0xac]);
    expect(splitStatefulBytecode(plain)).toBeNull();
  });

  it('returns null for truncated PUSHDATA1', () => {
    const bad = new Uint8Array([0x4c]);
    expect(splitStatefulBytecode(bad)).toBeNull();
  });

  it('returns null for truncated PUSHDATA2', () => {
    const bad = new Uint8Array([0x4d, 0x01]);
    expect(splitStatefulBytecode(bad)).toBeNull();
  });

  it('returns null for truncated PUSHDATA4', () => {
    const bad = new Uint8Array([0x4e, 0x01, 0x00, 0x00]);
    expect(splitStatefulBytecode(bad)).toBeNull();
  });

  it('returns null for PUSHDATA4 with length exceeding buffer', () => {
    // 0x4e followed by length=1000000 (LE), total buffer only 6 bytes
    const bad = new Uint8Array([0x4e, 0x40, 0x42, 0x0f, 0x00, 0xbd]);
    expect(splitStatefulBytecode(bad)).toBeNull();
  });

  it('finds separator after a real data push', () => {
    const push = new Uint8Array([0x03, 0xaa, 0xbb, 0xcc]);
    const sep = new Uint8Array([OP_STATESEPARATOR]);
    const code = new Uint8Array([0x51]);
    const full = new Uint8Array([...push, ...sep, ...code]);
    const result = splitStatefulBytecode(full);
    expect(result).not.toBeNull();
    expect(result!.codeScript).toEqual(code);
  });

  // ─── Adversarial cases (audit §3/§4) ───────────────────────────────────
  // Confirm that 0xbd bytes sitting INSIDE various data-push payloads are
  // NOT treated as OP_STATESEPARATOR. The first 0xbd *outside* any push is
  // the real separator. These cases are the ones the audit explicitly
  // flagged as "simple byte scan may be incorrect for adversarial inputs".

  it('does not treat 0xbd inside a direct push as a separator', () => {
    // 0x03 push of three 0xbd bytes, then a real OP_STATESEPARATOR, then code.
    const full = new Uint8Array([0x03, 0xbd, 0xbd, 0xbd, OP_STATESEPARATOR, 0x51]);
    const result = splitStatefulBytecode(full);
    expect(result).not.toBeNull();
    expect(result!.stateData).toEqual(new Uint8Array([0x03, 0xbd, 0xbd, 0xbd]));
    expect(result!.codeScript).toEqual(new Uint8Array([0x51]));
  });

  it('does not treat 0xbd inside an OP_PUSHDATA1 push as a separator', () => {
    // OP_PUSHDATA1 0x05 then 5 0xbd bytes, then a real separator, then code.
    const full = new Uint8Array([0x4c, 0x05, 0xbd, 0xbd, 0xbd, 0xbd, 0xbd, OP_STATESEPARATOR, 0x52]);
    const result = splitStatefulBytecode(full);
    expect(result).not.toBeNull();
    expect(result!.stateData).toEqual(new Uint8Array([0x4c, 0x05, 0xbd, 0xbd, 0xbd, 0xbd, 0xbd]));
    expect(result!.codeScript).toEqual(new Uint8Array([0x52]));
  });

  it('does not treat 0xbd inside an OP_PUSHDATA2 push as a separator', () => {
    // OP_PUSHDATA2 with little-endian length 0x0004 = 4 bytes, all 0xbd.
    const full = new Uint8Array([
      0x4d, 0x04, 0x00, 0xbd, 0xbd, 0xbd, 0xbd, OP_STATESEPARATOR, 0x53,
    ]);
    const result = splitStatefulBytecode(full);
    expect(result).not.toBeNull();
    expect(result!.codeScript).toEqual(new Uint8Array([0x53]));
  });

  // ─── Bounds-tightening regression tests (audit §8.2/2) ─────────────────
  // A push header whose claimed payload extends past the end of the buffer
  // must be treated as malformed. Without strict bounds, the cursor would
  // skip past a real separator and the caller would mis-classify a stateful
  // UTXO as stateless.

  it('returns null for direct push (0x01-0x4b) that claims more than remains', () => {
    // 0x05 claims 5 bytes follow; only 2 do, then a separator. The buffer
    // length alone would let the loop terminate without finding the 0xbd,
    // which is still safe — but malformed input must be flagged either way.
    const bad = new Uint8Array([0x05, 0xaa, 0xbb, OP_STATESEPARATOR, 0x51]);
    expect(splitStatefulBytecode(bad)).toBeNull();
  });

  it('returns null for OP_PUSHDATA1 that claims more than remains', () => {
    // 0x4c 0x05 claims 5 bytes follow; only 2 do.
    const bad = new Uint8Array([0x4c, 0x05, 0xaa, 0xbb]);
    expect(splitStatefulBytecode(bad)).toBeNull();
  });

  it('returns null for OP_PUSHDATA2 that claims more than remains', () => {
    // 0x4d 0x05 0x00 claims 5 bytes follow; only 2 do.
    const bad = new Uint8Array([0x4d, 0x05, 0x00, 0xaa, 0xbb]);
    expect(splitStatefulBytecode(bad)).toBeNull();
  });

  it('returns null for OP_PUSHDATA4 with sub-MAX length still overrunning', () => {
    // 0x4e claims 5 bytes follow; only 1 does. The OLD check
    // `pushLen > lockingBytecode.length` (5 > 6) is false and would let the
    // loop fall through; the new check `i + 5 + pushLen > length` catches it.
    const bad = new Uint8Array([0x4e, 0x05, 0x00, 0x00, 0x00, 0xbd]);
    expect(splitStatefulBytecode(bad)).toBeNull();
  });
});
