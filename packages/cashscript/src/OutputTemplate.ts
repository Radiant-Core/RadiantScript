import { binToHex } from '@bitauth/libauth';
import { hash160 } from '@radiantscript/utils';
import { Output, SatoshiAmount } from './interfaces.js';
import { buildStatefulOutput } from './RadiantHelpers.js';
import { addressToLockScript, createOpReturnOutput } from './utils.js';

/**
 * Output-template helpers ("build the expected output, assert equality" idiom).
 *
 * The covenant-safety failure mode is that the transaction BUILDER and the
 * on-chain COVENANT disagree about the output set: the builder pays out a set
 * of outputs that does not match what the covenant's introspection enforces, so
 * the spend reverts on-chain (best case) or — for a covenant that derives a
 * split/payout from a value it does NOT fully constrain — silently produces an
 * attacker-favourable result.
 *
 * These helpers let a caller declare the expected outputs from ONE source of
 * truth and assert the built transaction matches (see
 * {@link Transaction.withExactOutputs}). Each helper produces the SAME `Output`
 * shape the SDK already uses, so `.to()`, `.withOpReturn()`, and the templates
 * are fully interchangeable.
 */

/**
 * Normalised, comparable view of an output: its final locking bytecode and
 * amount. This is what the asserted-output validator compares the built
 * transaction against, so that two outputs that encode the same locking script
 * and amount compare equal regardless of how they were declared (address string
 * vs. raw bytecode).
 */
export interface ResolvedOutput {
  lockingBytecode: Uint8Array;
  amount: bigint;
}

/**
 * Resolve an `Output` (which may carry an address string or raw locking
 * bytecode, plus an optional `stateScript` of RAW state bytes) to its final
 * locking bytecode + bigint amount. Mirrors exactly what `Transaction.build()`
 * does when it encodes outputs, so a template and its built counterpart resolve
 * identically.
 *
 * When `stateScript` is present the resolved locking bytecode is the canonical
 * Radiant stateful layout `<pushState> OP_STATESEPARATOR <code>` — byte-for-byte
 * identical to {@link buildStatefulOutput}`(stateScript, code)`. The raw state
 * bytes are push-encoded by the SDK and the `OP_STATESEPARATOR` (0xbd) is
 * inserted for you; do NOT pre-push-encode or pre-separate them. See the
 * {@link Output.stateScript} contract.
 */
export function resolveOutput(output: Output): ResolvedOutput {
  const base = typeof output.to === 'string'
    ? addressToLockScript(output.to)
    : output.to;

  // `stateScript` holds the RAW state bytes (the value a covenant's
  // introspection compares against, e.g. `0x14 <pkh>`). Wrap them into the
  // canonical stateful layout — push-encode the state, insert OP_STATESEPARATOR
  // (0xbd), then the code — so this is byte-identical to buildStatefulOutput and
  // the on-chain `stateSeparatorByteIndex` lands AFTER the state (not at 0).
  // Callers that already hold the full stateful bytecode pass it as `to` and
  // leave `stateScript` undefined.
  const lockingBytecode = output.stateScript === undefined
    ? base
    : buildStatefulOutput(output.stateScript, base);

  const amount = typeof output.amount === 'bigint' ? output.amount : BigInt(output.amount);

  return { lockingBytecode, amount };
}

/**
 * Build a standard P2PKH output by intent.
 *
 * @param recipient  Either a Radiant base58 P2PKH/P2SH **address string**, or a
 *                   20-byte **public-key hash** (`hash160(pubkey)`). A 33-byte
 *                   compressed (or 65-byte uncompressed) public key is hashed
 *                   for you.
 * @param amount     Output value in photons (number or bigint).
 */
export function p2pkhOutput(recipient: string | Uint8Array, amount: SatoshiAmount): Output {
  if (typeof recipient === 'string') {
    return { to: recipient, amount };
  }

  // A 20-byte value is already a pkh; 33/65-byte values are public keys we
  // hash. Anything else is a caller error — reject it loudly rather than
  // emit a malformed locking script.
  let pkh: Uint8Array;
  if (recipient.byteLength === 20) {
    pkh = recipient;
  } else if (recipient.byteLength === 33 || recipient.byteLength === 65) {
    pkh = hash160(recipient);
  } else {
    throw new Error(
      'p2pkhOutput: expected an address, a 20-byte pkh, or a 33/65-byte public key, '
      + `got ${recipient.byteLength} bytes`,
    );
  }

  const lockingBytecode = new Uint8Array([
    0x76, // OP_DUP
    0xa9, // OP_HASH160
    0x14, // push 20 bytes
    ...pkh,
    0x88, // OP_EQUALVERIFY
    0xac, // OP_CHECKSIG
  ]);

  return { to: lockingBytecode, amount };
}

/**
 * Build a standard P2SH output by intent. `address` must be a Radiant P2SH (or
 * P2PKH) base58 address — its locking bytecode is derived exactly as `build()`
 * would, so this is just an intent-revealing alias for `{ to: address, amount }`.
 */
export function p2shOutput(address: string, amount: SatoshiAmount): Output {
  return { to: address, amount };
}

/**
 * Build an `OP_RETURN` data output. Identical encoding to
 * {@link Transaction.withOpReturn} (and {@link createOpReturnOutput}); exposed
 * here so an OP_RETURN can be part of a declared exact-output set.
 *
 * @param chunks  Push-data chunks. A `0x`-prefixed string is treated as hex,
 *                everything else as UTF-8.
 */
export function opReturnOutput(chunks: string[]): Output {
  // Re-use the canonical encoder so OP_RETURN templates are byte-identical to
  // outputs produced by `.withOpReturn()`. utils.ts does not import this module,
  // so the static import is cycle-free.
  return createOpReturnOutput(chunks);
}

/**
 * Build a generic output from raw locking bytecode. Use this for any
 * non-standard or contract output the typed helpers do not cover.
 *
 * @param spec.lockingBytecode  The full output locking bytecode (the `<code>`
 *                              section when `stateScript` is supplied).
 * @param spec.stateScript      Optional RAW Radiant state bytes. When present
 *                              the SDK wraps them into the canonical stateful
 *                              layout `<pushState> OP_STATESEPARATOR <code>`
 *                              (push-encoding the state and inserting the 0xbd
 *                              separator for you) — byte-identical to
 *                              {@link buildStatefulOutput}. Pass the bare state
 *                              the covenant compares against (e.g. `0x14<pkh>`),
 *                              NOT pre-pushed or pre-separated bytes. Most
 *                              callers leave this undefined and pass the
 *                              already-assembled stateful bytecode as
 *                              `lockingBytecode`.
 * @param spec.amount           Output value in photons.
 */
export function rawOutput(spec: {
  lockingBytecode: Uint8Array;
  amount: SatoshiAmount;
  stateScript?: Uint8Array;
}): Output {
  return {
    to: spec.lockingBytecode,
    amount: spec.amount,
    stateScript: spec.stateScript,
  };
}

/**
 * Compare two resolved outputs for byte-exact equality (locking bytecode and
 * amount). Used by the asserted-output validator.
 */
export function resolvedOutputsEqual(a: ResolvedOutput, b: ResolvedOutput): boolean {
  return a.amount === b.amount && binToHex(a.lockingBytecode) === binToHex(b.lockingBytecode);
}
