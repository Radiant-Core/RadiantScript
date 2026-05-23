/**
 * Test fixture key material — rewritten off the legacy `bitbox-sdk` (a BCH
 * library) onto libauth + Radiant base58 addressing.
 *
 * Keys are deterministically derived from fixed 32-byte seeds so test output
 * stays stable across runs without needing an HD-wallet implementation.
 *
 * The exported `alice`/`bob` objects expose `.toWIF()` and `.privateKey` so
 * they remain drop-in compatible with `SignatureTemplate`. The original
 * `oracle`, `oraclePk`, and `bitbox` exports are e2e-only and are now
 * lazy-throwing stubs — calling them from a unit test will fail loudly and
 * is intentional (see `SECURITY_AUDIT_REPORT.md` §3.13).
 */
import {
  encodeBase58AddressFormat,
  encodePrivateKeyWif,
  instantiateSecp256k1,
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

  initialised = true;
}

// E2E-only legacy exports. These previously used bitbox-sdk; they are kept
// for source-compatibility with the e2e suites (which require a Radiant
// node and are not part of the standard unit-test run). Importing the e2e
// stubs in a unit test does not crash module load, but *calling* them
// will throw loudly.
const e2eOnly = (name: string): never => {
  throw new Error(
    `${name} requires a Radiant-aware oracle implementation; rewrite off bitbox-sdk before use (see SECURITY_AUDIT_REPORT.md §3.13).`,
  );
};
export const oracle = {
  keypair: bob,
  createMessage: (_blockHeight: number, _price: number): Buffer => e2eOnly('PriceOracle.createMessage'),
  signMessage: (_msg: Buffer): Buffer => e2eOnly('PriceOracle.signMessage'),
};
export const oraclePk = bobPk;
export const bitbox: never = undefined as unknown as never;
