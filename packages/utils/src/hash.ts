// Synchronous SHA-256 / SHA-512 / RIPEMD-160 facades used across the SDK
// (Transaction sighash, P2SH address derivation, WIF decoding, etc.).
//
// Backed by @noble/hashes — a small, audited, sync-only pure-JS hash library
// that works in both Node and the browser without WASM init. Previously this
// module relied on `hash.js`, which has been unmaintained since 2020.
//
// The libauth alternative was considered (libauth is already a transitive
// dependency) but rejected: libauth's hash implementations are WASM-backed
// and require an async `instantiateSha256()` step. Keeping this facade sync
// matters because libauth itself accepts an injected sync `{ hash: sha256 }`
// in APIs like `decodePrivateKeyWif`, and breaking the sync contract here
// would ripple into every caller.

// @noble/hashes v1 ships dual CJS + ESM (v2 is ESM-only, which jest's CJS
// loader cannot consume without an explicit transform). Stay on v1 until the
// jest pipeline is moved off CJS.
import { sha256 as nobleSha256 } from '@noble/hashes/sha256';
import { sha512 as nobleSha512 } from '@noble/hashes/sha512';
import { ripemd160 as nobleRipemd160 } from '@noble/hashes/ripemd160';

export function sha512(payload: Uint8Array): Uint8Array {
  return nobleSha512(payload);
}

export function sha256(payload: Uint8Array): Uint8Array {
  return nobleSha256(payload);
}

export function ripemd160(payload: Uint8Array): Uint8Array {
  return nobleRipemd160(payload);
}

export function hash160(payload: Uint8Array): Uint8Array {
  return ripemd160(sha256(payload));
}

export function hash256(payload: Uint8Array): Uint8Array {
  return sha256(sha256(payload));
}
