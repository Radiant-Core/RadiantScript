/**
 * Radiant-native price oracle helper used by the HodlVault e2e example and
 * test. Rewritten off the legacy BCH dependencies (`bitbox-sdk`,
 * `bitcoincashjs-lib`) onto `@bitauth/libauth` for secp256k1 and
 * `@radiantscript/utils` for the SHA-256 hash adapter.
 *
 * Message layout (matches the on-chain `HodlVault` contract):
 *
 *     [ blockHeight : 4 bytes script-num | price : 4 bytes script-num ]
 *
 * Both fields are encoded using Bitcoin Script's minimally-encoded signed
 * little-endian integer format, padded to 4 bytes with trailing zeros. The
 * contract reads them back via `oracleMessage.split(4)` + `int(...)`.
 *
 * NOTE: libauth's secp256k1 lives behind WASM and is async-instantiated, so
 * `PriceOracle` must be constructed asynchronously via `PriceOracle.create()`
 * before any of its methods are called.
 */
import { bigIntToScriptNumber, instantiateSecp256k1, Secp256k1 } from '@bitauth/libauth';
import { sha256 } from '@radiantscript/utils';

export class PriceOracle {
  /** 33-byte compressed secp256k1 public key. */
  public readonly publicKey: Uint8Array;

  private constructor(
    public readonly privateKey: Uint8Array,
    private readonly secp256k1: Secp256k1,
  ) {
    if (privateKey.length !== 32) {
      throw new Error(`PriceOracle: private key must be 32 bytes, got ${privateKey.length}`);
    }
    this.publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  }

  /**
   * Asynchronously instantiate the WASM secp256k1 backend and build an
   * oracle bound to the given 32-byte private key.
   */
  static async create(privateKey: Uint8Array): Promise<PriceOracle> {
    const secp = await instantiateSecp256k1();
    return new PriceOracle(privateKey, secp);
  }

  /**
   * Encode a `(blockHeight, price)` pair into the 8-byte message format
   * expected by the on-chain contract.
   */
  createMessage(blockHeight: number, price: number): Uint8Array {
    const out = new Uint8Array(8);
    out.set(encodeScriptNum4(blockHeight), 0);
    out.set(encodeScriptNum4(price), 4);
    return out;
  }

  /**
   * Schnorr-sign `sha256(message)` using the oracle's private key. The
   * returned 64-byte signature is suitable for Radiant's `checkDataSig`.
   */
  signMessage(message: Uint8Array): Uint8Array {
    return this.secp256k1.signMessageHashSchnorr(this.privateKey, sha256(message));
  }
}

/**
 * Encode `n` as a Bitcoin Script number padded to exactly 4 bytes. Throws if
 * the minimally-encoded form does not fit, or if the natural 4-byte encoding
 * would set the sign bit (which would silently flip the value's sign when
 * the contract parses it back via `int(bytes4)`).
 */
function encodeScriptNum4(n: number): Uint8Array {
  if (!Number.isInteger(n)) {
    throw new Error(`PriceOracle: value ${n} is not an integer`);
  }
  const encoded = bigIntToScriptNumber(BigInt(n));
  if (encoded.length > 4) {
    throw new Error(`PriceOracle: value ${n} does not fit in a 4-byte script number`);
  }
  if (encoded.length === 4 && (encoded[3] & 0x80) !== 0) {
    // The 4th byte's top bit is the sign bit; padding is unsafe here.
    throw new Error(`PriceOracle: value ${n} sign-bit collides with 4-byte width`);
  }
  const out = new Uint8Array(4);
  out.set(encoded, 0);
  return out;
}
