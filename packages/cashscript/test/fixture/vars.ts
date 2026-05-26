/**
 * Test fixture key material — rewritten off the legacy `bitbox-sdk` (a BCH
 * library) onto libauth + Radiant base58 addressing.
 *
 * Keys are deterministically derived from fixed 32-byte seeds so test output
 * stays stable across runs without needing an HD-wallet implementation.
 *
 * The exported `alice`/`bob` objects expose `.toWIF()` and `.privateKey` so
 * they remain drop-in compatible with `SignatureTemplate`. The `oracle` /
 * `oraclePk` exports are now backed by the Radiant-native `PriceOracle`
 * (see `examples/PriceOracle.ts`); they require `await initFixtures()`
 * before use, same as the address exports.
 */
import {
  bigIntToScriptNumber,
  encodeBase58AddressFormat,
  encodePrivateKeyWif,
  instantiateSecp256k1,
  Secp256k1,
} from '@bitauth/libauth';
import { hash160, sha256 } from '@radiantscript/utils';
import { Network } from '../../src/interfaces.js';

export const network = Network.MAINNET;

const sha256Adapter = { hash: (input: Uint8Array): Uint8Array => sha256(input) };

// Deterministic, hard-coded private keys. Picked from outside the curve-order
// danger zone (well under N). DO NOT REUSE THESE FOR ANYTHING REAL.
const ALICE_PK_BIN = new Uint8Array([
  0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
  0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
]);
const BOB_PK_BIN = new Uint8Array([
  0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22,
  0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22,
]);

export interface RadiantKeypair {
  /** 32-byte private key, raw bytes. */
  privateKey: Uint8Array;
  /** 33-byte compressed secp256k1 public key (set after `initFixtures()`). */
  publicKey: Uint8Array;
  /** Mainnet WIF — accepted by `SignatureTemplate(keypair)`. */
  toWIF(): string;
}

// libauth's secp256k1 lives behind WASM and is async-instantiated. The repo's
// tsconfig targets es2015, so top-level await is not available here. Tests
// that exercise key material must `await initFixtures()` in `beforeAll(...)`
// before reading `alicePk`, `aliceAddress`, etc. Until then those exports
// hold zero-byte placeholders so module load remains synchronous.
let initialised = false;
export const alice: RadiantKeypair = {
  privateKey: ALICE_PK_BIN,
  publicKey: new Uint8Array(33),
  toWIF: () => encodePrivateKeyWif(sha256Adapter, ALICE_PK_BIN, 'mainnet'),
};
export const bob: RadiantKeypair = {
  privateKey: BOB_PK_BIN,
  publicKey: new Uint8Array(33),
  toWIF: () => encodePrivateKeyWif(sha256Adapter, BOB_PK_BIN, 'mainnet'),
};

export let alicePk: Uint8Array = alice.publicKey;
export let bobPk: Uint8Array = bob.publicKey;
export let alicePkh: Uint8Array = new Uint8Array(20);
export let bobPkh: Uint8Array = new Uint8Array(20);
export let aliceAddress: string = '';
export let bobAddress: string = '';

/**
 * Asynchronously derive secp256k1 public keys for the fixture private keys
 * and populate the address / pkh exports. Idempotent — safe to call from
 * multiple `beforeAll(...)` hooks.
 */
export async function initFixtures(): Promise<void> {
  if (initialised) return;
  const secp = await instantiateSecp256k1();
  alice.publicKey = secp.derivePublicKeyCompressed(ALICE_PK_BIN);
  bob.publicKey = secp.derivePublicKeyCompressed(BOB_PK_BIN);

  alicePk = alice.publicKey;
  bobPk = bob.publicKey;
  alicePkh = hash160(alicePk);
  bobPkh = hash160(bobPk);

  // Radiant P2PKH address version bytes: 0x00 mainnet, 0x6f testnet+regtest.
  const p2pkhVersion = network === Network.MAINNET ? 0x00 : 0x6f;
  aliceAddress = encodeBase58AddressFormat(sha256Adapter, p2pkhVersion, alicePkh);
  bobAddress = encodeBase58AddressFormat(sha256Adapter, p2pkhVersion, bobPkh);

  oracleSecp = secp;
  oraclePk = bob.publicKey;

  initialised = true;
}

// ---------------------------------------------------------------------------
// Price oracle (Radiant-native).
//
// This is the same construction as `examples/PriceOracle.ts`, inlined here
// so the `cashscript` package's tsconfig — which scopes to `src/**` +
// `test/**` — doesn't need to reach across the monorepo into `examples/`.
//
// Bob's keypair doubles as the oracle's signing key. Both `oracle.createMessage`
// and `oracle.signMessage` are synchronous; the WASM secp256k1 backend is
// stashed during `initFixtures()`. Calling either before `initFixtures()`
// returns throws loudly to surface ordering bugs.
// ---------------------------------------------------------------------------
let oracleSecp: Secp256k1 | undefined;
export let oraclePk: Uint8Array = bob.publicKey;

function encodeOracleScriptNum4(n: number): Uint8Array {
  const encoded = bigIntToScriptNumber(BigInt(n));
  if (encoded.length > 4) {
    throw new Error(`oracle: value ${n} does not fit in a 4-byte script number`);
  }
  if (encoded.length === 4 && (encoded[3] & 0x80) !== 0) {
    throw new Error(`oracle: value ${n} sign-bit collides with 4-byte width`);
  }
  const out = new Uint8Array(4);
  out.set(encoded, 0);
  return out;
}

export const oracle = {
  keypair: bob,
  createMessage(blockHeight: number, price: number): Uint8Array {
    const out = new Uint8Array(8);
    out.set(encodeOracleScriptNum4(blockHeight), 0);
    out.set(encodeOracleScriptNum4(price), 4);
    return out;
  },
  signMessage(message: Uint8Array): Uint8Array {
    if (!oracleSecp) {
      throw new Error('oracle: call await initFixtures() before signMessage');
    }
    return oracleSecp.signMessageHashSchnorr(BOB_PK_BIN, sha256(message));
  },
};
