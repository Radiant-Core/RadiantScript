import { binToHex, hexToBin } from '@bitauth/libauth';

/**
 * Encodes a 36-byte token reference from a txid and output index (vout).
 *
 * Radiant references are 36 bytes: 32-byte txid (big-endian) + 4-byte vout (little-endian).
 *
 * @param txid  The transaction ID as a 64-char hex string (big-endian as shown in explorers).
 * @param vout  The output index (0-based).
 * @returns     A Uint8Array of 36 bytes suitable for use as a `bytes36` contract parameter.
 */
export function encodeTokenRef(txid: string, vout: number): Uint8Array {
  if (txid.length !== 64) {
    throw new Error(`txid must be 64 hex characters, got ${txid.length}`);
  }
  if (vout < 0 || vout > 0xFFFFFFFF) {
    throw new Error(`vout must be a 32-bit unsigned integer, got ${vout}`);
  }

  const txidBytes = hexToBin(txid);

  const voutBytes = new Uint8Array(4);
  new DataView(voutBytes.buffer).setUint32(0, vout, true);

  const ref = new Uint8Array(36);
  ref.set(txidBytes, 0);
  ref.set(voutBytes, 32);
  return ref;
}

/**
 * Decodes a 36-byte token reference back to txid and vout.
 *
 * @param ref  A 36-byte Uint8Array token reference.
 * @returns    An object with `txid` (64-char hex, big-endian) and `vout` (number).
 */
export function decodeTokenRef(ref: Uint8Array): { txid: string; vout: number } {
  if (ref.byteLength !== 36) {
    throw new Error(`Token reference must be 36 bytes, got ${ref.byteLength}`);
  }
  const txid = binToHex(ref.slice(0, 32));
  const vout = new DataView(ref.buffer, ref.byteOffset + 32, 4).getUint32(0, true);
  return { txid, vout };
}

/**
 * Builds the locking bytecode for a Radiant stateful contract output.
 *
 * A stateful contract output has the structure:
 *   <stateData> OP_STATESEPARATOR <codeScript>
 *
 * The OP_STATESEPARATOR (0xbd) divides the state section from the code section.
 * When spending, `tx.inputs[i].stateScript` returns the bytes before the separator
 * and `tx.inputs[i].codeScript` returns the bytes after it.
 *
 * @param stateData   The raw state bytes to place before OP_STATESEPARATOR.
 * @param codeScript  The compiled code script (the locking script without state).
 *                    Typically obtained via `contract.getRedeemScriptHex()` decoded,
 *                    or directly as `scriptToBytecode(redeemScript)`.
 * @returns           A Uint8Array to use as the output's lockingBytecode.
 */
export function buildStatefulOutput(stateData: Uint8Array, codeScript: Uint8Array): Uint8Array {
  const OP_STATESEPARATOR = 0xbd;

  const pushState = encodePush(stateData);

  const result = new Uint8Array(pushState.byteLength + 1 + codeScript.byteLength);
  result.set(pushState, 0);
  result[pushState.byteLength] = OP_STATESEPARATOR;
  result.set(codeScript, pushState.byteLength + 1);
  return result;
}

/**
 * Encodes a data push for a byte array, following Bitcoin's minimal push encoding.
 *
 * @param data  The bytes to push.
 * @returns     The push opcode(s) + data as a Uint8Array.
 */
export function encodePush(data: Uint8Array): Uint8Array {
  const len = data.byteLength;
  let prefix: Uint8Array;

  if (len === 0) {
    prefix = new Uint8Array([0x4c, 0x00]);
  } else if (len < 76) {
    prefix = new Uint8Array([len]);
  } else if (len < 256) {
    prefix = new Uint8Array([0x4c, len]);
  } else if (len < 65536) {
    prefix = new Uint8Array([0x4d, len & 0xff, (len >> 8) & 0xff]);
  } else {
    throw new Error('Data too large to push (>= 65536 bytes)');
  }

  const result = new Uint8Array(prefix.byteLength + len);
  result.set(prefix, 0);
  result.set(data, prefix.byteLength);
  return result;
}

/**
 * Encodes an integer value as a minimally-encoded Bitcoin Script number.
 *
 * @param value  A JavaScript number (must be a safe integer).
 * @returns      A Uint8Array of the encoded script integer.
 */
export function encodeScriptInt(value: number): Uint8Array {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Value ${value} is not a safe integer`);
  }
  if (value === 0) return new Uint8Array(0);

  const negative = value < 0;
  let absValue = Math.abs(value);
  const bytes: number[] = [];

  while (absValue > 0) {
    bytes.push(absValue & 0xff);
    absValue >>= 8;
  }

  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(negative ? 0x80 : 0x00);
  } else if (negative) {
    bytes[bytes.length - 1] |= 0x80;
  }

  return new Uint8Array(bytes);
}

/**
 * Splits a full locking bytecode back into its state and code parts
 * by finding the OP_STATESEPARATOR (0xbd) byte boundary.
 *
 * NOTE: This performs a simple byte scan — it finds the first 0xbd byte
 * that is not inside a data push. For production use, parse the script properly.
 *
 * @param lockingBytecode  The full locking bytecode of a stateful contract UTXO.
 * @returns                `{ stateData, codeScript }` or `null` if no separator found.
 */
export function splitStatefulBytecode(
  lockingBytecode: Uint8Array,
): { stateData: Uint8Array; codeScript: Uint8Array } | null {
  const OP_STATESEPARATOR = 0xbd;
  let i = 0;

  while (i < lockingBytecode.length) {
    const byte = lockingBytecode[i];

    if (byte === OP_STATESEPARATOR) {
      return {
        stateData: lockingBytecode.slice(0, i),
        codeScript: lockingBytecode.slice(i + 1),
      };
    }

    if (byte >= 0x01 && byte <= 0x4b) {
      i += 1 + byte;
    } else if (byte === 0x4c) {
      if (i + 1 >= lockingBytecode.length) return null;
      const pushLen = lockingBytecode[i + 1];
      i += 2 + pushLen;
    } else if (byte === 0x4d) {
      if (i + 2 >= lockingBytecode.length) return null;
      const pushLen = lockingBytecode[i + 1] | (lockingBytecode[i + 2] << 8);
      i += 3 + pushLen;
    } else if (byte === 0x4e) {
      if (i + 4 >= lockingBytecode.length) return null;
      const pushLen = (lockingBytecode[i + 1]
        | (lockingBytecode[i + 2] << 8)
        | (lockingBytecode[i + 3] << 16)
        | (lockingBytecode[i + 4] << 24)) >>> 0;
      if (pushLen > lockingBytecode.length) return null;
      i += 5 + pushLen;
    } else {
      i += 1;
    }
  }

  return null;
}
