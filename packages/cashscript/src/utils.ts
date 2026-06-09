import {
  binToHex,
  createTransactionContextCommon,
  bigIntToBinUint64LE,
  Transaction,
  generateSigningSerializationBCH,
  utf8ToBin,
  hexToBin,
  flattenBinArray,
  encodeBase58AddressFormat,
  decodeBase58AddressFormat,
} from '@bitauth/libauth';
import {
  encodeInt,
  hash160,
  Op,
  Script,
  scriptToBytecode,
  sha256,
} from '@radiantscript/utils';
import {
  Utxo,
  Output,
  Network,
  Recipient,
} from './interfaces.js';
import {
  P2PKH_OUTPUT_SIZE,
  VERSION_SIZE,
  LOCKTIME_SIZE,
  DUST_LIMIT,
  MAX_SAFE_SATOSHIS,
} from './constants.js';
import {
  OutputSatoshisTooSmallError,
  Reason,
  FailedTransactionError,
  FailedRequireError,
  FailedTimeCheckError,
  FailedSigCheckError,
} from './Errors.js';
import { encodePush } from './RadiantHelpers.js';

// `encodeBase58AddressFormat` / `decodeBase58AddressFormat` in libauth ^1.19
// require an injected SHA-256 implementation; wrap the project's own SHA-256
// in the shape libauth expects so callers don't need to thread it through.
const sha256Adapter = { hash: (input: Uint8Array): Uint8Array => sha256(input) };

// ////////// PARAMETER VALIDATION ////////////////////////////////////////////
export function validateRecipient(recipient: Recipient): void {
  // `amount` may be a number or a bigint; compare in bigint space so the
  // dust check works for both. DUST_LIMIT is a small constant, lossless to
  // promote.
  const amountBig = typeof recipient.amount === 'bigint'
    ? recipient.amount
    : BigInt(recipient.amount);
  if (amountBig < BigInt(DUST_LIMIT)) {
    // Reporters typically expect a number; format the bigint as Number for
    // small values and as the raw bigint string for huge ones.
    throw new OutputSatoshisTooSmallError(
      amountBig <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amountBig) : (amountBig as unknown as number),
    );
  }

  // Reject malformed addresses early so the caller sees a descriptive error
  // here rather than a libauth decoder string surfacing deep in `build()`.
  // Radiant uses Bitcoin-style base58check addresses (no cashaddr prefix).
  if (typeof recipient.to === 'string') {
    const decoded = decodeBase58AddressFormat(sha256Adapter, recipient.to);
    if (typeof decoded === 'string') {
      throw new Error(`Invalid recipient address "${recipient.to}": ${decoded}`);
    }
  }
}

/**
 * Validate a UTXO returned by a network provider before it is trusted as a
 * transaction input (M-4). Providers are untrusted: a malformed or malicious
 * response (bad txid, negative vout, non-integer/negative/overflow satoshis)
 * must be rejected here rather than surfacing as a downstream BigInt() throw or
 * — worse — flowing unverified into a sighash preimage (see H-2).
 *
 * Kept deliberately defensive but not overzealous so valid mainnet UTXOs pass.
 *
 * @throws If any field is malformed.
 */
export function validateUtxo<T extends Utxo>(utxo: T): T {
  if (typeof utxo.txid !== 'string' || !/^[0-9a-f]{64}$/.test(utxo.txid)) {
    throw new Error(`Invalid UTXO: txid must be 64 lowercase hex chars, got "${utxo.txid}"`);
  }
  if (typeof utxo.vout !== 'number' || !Number.isInteger(utxo.vout) || utxo.vout < 0) {
    throw new Error(`Invalid UTXO ${utxo.txid}: vout must be a non-negative integer, got ${utxo.vout}`);
  }
  // satoshis arrives as a JS number; cap at MAX_SAFE_SATOSHIS (uint64 max) but
  // also require integer precision so we never carry a lossy value forward.
  if (
    typeof utxo.satoshis !== 'number'
    || !Number.isInteger(utxo.satoshis)
    || utxo.satoshis < 0
    || BigInt(utxo.satoshis) > MAX_SAFE_SATOSHIS
  ) {
    throw new Error(
      `Invalid UTXO ${utxo.txid}: satoshis must be an integer in [0, ${MAX_SAFE_SATOSHIS}], got ${utxo.satoshis}`,
    );
  }
  return utxo;
}

// ////////// SIZE CALCULATIONS ///////////////////////////////////////////////
export function getInputSize(inputScript: Uint8Array): number {
  const scriptSize = inputScript.byteLength;
  const varIntSize = scriptSize > 252 ? 3 : 1;
  return 32 + 4 + varIntSize + scriptSize + 4;
}

/**
 * Size (in bytes) of a BCH-style sighash preimage covering `script`.
 *
 * @deprecated Legacy — unused by the live build path. The live
 * transaction-build path NO LONGER pushes a sighash preimage onto the unlocking
 * stack (P5). Radiant covenants use reference-based introspection, not preimage
 * covenants, and the `Contract` constructor rejects any artifact that sets the
 * legacy `abiFunction.covenant` flag. This helper is retained only as a pure
 * size utility (and for its existing unit tests) but is no longer invoked when
 * building a transaction; do not wire it into new build logic.
 */
export function getPreimageSize(script: Uint8Array): number {
  const scriptSize = script.byteLength;
  const varIntSize = scriptSize > 252 ? 3 : 1;
  return 4 + 32 + 32 + 36 + varIntSize + scriptSize + 8 + 4 + 32 + 4 + 4;
}

export function getTxSizeWithoutInputs(outputs: Output[]): number {
  // Transaction format:
  // Version (4 Bytes)
  // TxIn Count (1 ~ 9B)
  // For each TxIn:
  //   Outpoint (36B)
  //   Script Length (1 ~ 9B)
  //   ScriptSig(?)
  //   Sequence (4B)
  // TxOut Count (1 ~ 9B)
  // For each TxOut:
  //   Value (8B)
  //   Script Length(1 ~ 9B)*
  //   Script (?)*
  // LockTime (4B)

  let size = VERSION_SIZE + LOCKTIME_SIZE;
  size += outputs.reduce((acc, output) => {
    // A `stateScript` (raw Radiant state bytes) is wrapped into the canonical
    // `<pushState> OP_STATESEPARATOR(1B) <code>` layout by resolveOutput, so its
    // serialized contribution is the push-encoded state plus the 1-byte
    // separator — NOT just the raw state length. Mirror buildStatefulOutput's
    // encoding exactly so the fee estimate matches the bytecode that ships.
    const stateSize = output.stateScript === undefined
      ? 0
      : encodePush(output.stateScript).byteLength + 1;

    if (typeof output.to === 'string') {
      return acc + P2PKH_OUTPUT_SIZE + stateSize;
    }

    // Size of a raw/OP_RETURN output = byteLength + 8 (amount) + 2 (scriptSize)
    return acc + output.to.byteLength + stateSize + 8 + 2;
  }, 0);
  // Add tx-out count (accounting for a potential change output)
  size += encodeInt(outputs.length + 1).byteLength;

  return size;
}

// ////////// BUILD OBJECTS ///////////////////////////////////////////////////
/**
 * Build an unlocking (input) script from the encoded arguments, optional
 * function selector, and — legacy only — an optional sighash preimage.
 *
 * P5 / legacy: the live build path no longer passes `preimage` (the
 * preimage-on-stack covenant path has been removed; Radiant uses
 * reference-based introspection). The `preimage` parameter is **deprecated,
 * unused by the live path, and always undefined in production**; it is retained
 * only for backward compatibility and its existing unit tests. The function
 * itself remains in active use for building selector/arg input scripts — only
 * the trailing `preimage` argument is legacy. Do not pass it in new code.
 */
export function createInputScript(
  redeemScript: Script,
  encodedArgs: Uint8Array[],
  selector?: number,
  preimage?: Uint8Array,
): Uint8Array {
  // Create unlock script / redeemScriptSig (add potential preimage and selector)
  const unlockScript = encodedArgs.reverse();
  if (preimage !== undefined) unlockScript.push(preimage);
  if (selector !== undefined) unlockScript.push(encodeInt(selector));

  // Create input script and compile it to bytecode
  const inputScript = [...unlockScript, scriptToBytecode(redeemScript)];
  return scriptToBytecode(inputScript);
}

export function createOpReturnOutput(
  opReturnData: string[],
): Output {
  const script = [
    Op.OP_RETURN,
    ...opReturnData.map((output: string) => toBin(output)),
  ];

  return { to: encodeNullDataScript(script), amount: 0 };
}

function toBin(output: string): Uint8Array {
  const data = output.replace(/^0x/, '');
  const encode = data === output ? utf8ToBin : hexToBin;
  return encode(data);
}

export function createSighashPreimage(
  transaction: Transaction,
  input: { satoshis: number },
  inputIndex: number,
  coveredBytecode: Uint8Array,
  hashtype: number,
): Uint8Array {
  const state = createTransactionContextCommon({
    inputIndex,
    sourceOutput: { satoshis: bigIntToBinUint64LE(BigInt(input.satoshis)) },
    spendingTransaction: transaction,
  });

  const sighashPreimage = generateSigningSerializationBCH({
    correspondingOutput: state.correspondingOutput,
    coveredBytecode,
    forkId: new Uint8Array([0, 0, 0]),
    locktime: state.locktime,
    outpointIndex: state.outpointIndex,
    outpointTransactionHash: state.outpointTransactionHash,
    outputValue: state.outputValue,
    sequenceNumber: state.sequenceNumber,
    sha256: { hash: sha256 },
    signingSerializationType: new Uint8Array([hashtype]),
    transactionOutpoints: state.transactionOutpoints,
    transactionOutputs: state.transactionOutputs,
    transactionSequenceNumbers: state.transactionSequenceNumbers,
    version: 2,
  });

  return sighashPreimage;
}

export function buildError(reason: string, meepStr: string): FailedTransactionError {
  const require = [
    Reason.EVAL_FALSE, Reason.VERIFY, Reason.EQUALVERIFY, Reason.CHECKMULTISIGVERIFY,
    Reason.CHECKSIGVERIFY, Reason.CHECKDATASIGVERIFY, Reason.NUMEQUALVERIFY,
    // Radiant-specific require-equivalent failures
    Reason.PUSHINPUTREF_MISMATCH, Reason.REQUIREINPUTREF_MISSING,
    Reason.DISALLOWPUSHINPUTREF_VIOLATION, Reason.DISALLOWPUSHINPUTREFSIBLING_VIOLATION,
    Reason.SINGLETON_DUPLICATE, Reason.REF_VALUE_SUM_MISMATCH,
    Reason.CODE_SCRIPT_MISMATCH, Reason.STATE_SEPARATOR_INVALID,
  ];
  const timeCheck = [Reason.NEGATIVE_LOCKTIME, Reason.UNSATISFIED_LOCKTIME];
  const sigCheck = [
    Reason.SIG_COUNT, Reason.PUBKEY_COUNT, Reason.SIG_HASHTYPE, Reason.SIG_DER,
    Reason.SIG_HIGH_S, Reason.SIG_NULLFAIL, Reason.SIG_BADLENGTH, Reason.SIG_NONSCHNORR,
  ];

  if (toRegExp(require).test(reason)) {
    return new FailedRequireError(reason, meepStr);
  }

  if (toRegExp(timeCheck).test(reason)) {
    return new FailedTimeCheckError(reason, meepStr);
  }

  if (toRegExp(sigCheck).test(reason)) {
    return new FailedSigCheckError(reason, meepStr);
  }

  return new FailedTransactionError(reason, meepStr);
}

function toRegExp(reasons: string[]): RegExp {
  // Escape special regex characters to prevent ReDoS attacks
  const escapeRegExp = (string: string): string => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Sanity bound to prevent pathologically large patterns. The `reasons`
  // passed by `buildError` are fixed internal constant lists (already
  // regex-escaped above, so there is no ReDoS exposure from user input); the
  // largest of them (the require-equivalent failure list) is ~740 chars, so the
  // previous 500-char cap tripped on EVERY buildError call and masked the real
  // failure reason with "Pattern too long". 2000 comfortably fits all three
  // lists while still bounding runaway growth.
  const MAX_PATTERN_LENGTH = 2000;
  const joinedPattern = reasons.map(escapeRegExp).join('|');

  if (joinedPattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Pattern too long: ${joinedPattern.length} characters exceeds maximum of ${MAX_PATTERN_LENGTH}`);
  }

  return new RegExp(joinedPattern);
}

// ////////// MISC ////////////////////////////////////////////////////////////
export function meep(tx: any, utxos: Utxo[], script: Script, network: string = Network.MAINNET): string {
  const scriptPubkey = binToHex(scriptToLockingBytecode(script, network));
  return `meep debug --tx=${tx} --idx=0 --amt=${utxos[0].satoshis} --pkscript=${scriptPubkey}`;
}

export function scriptToAddress(script: Script, network: string): string {
  const scriptHash = hash160(scriptToBytecode(script));
  const version = getP2SHVersionByte(network);
  // `encodeBase58AddressFormat` performs: prepend version, sha256d checksum,
  // base58 encode. Returns a plain string — no error path for valid 20-byte
  // payloads, but we guard anyway.
  return encodeBase58AddressFormat(sha256Adapter, version, scriptHash);
}

/**
 * Build the P2SH locking-script bytecode for a redeem script:
 *   `OP_HASH160 <20-byte hash> OP_EQUAL` (23 bytes).
 *
 * Note: the `network` parameter is kept for backward compatibility but is no
 * longer required — P2SH locking scripts are network-agnostic; only the
 * encoded *address* (see `scriptToAddress`) depends on the network.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function scriptToLockingBytecode(script: Script, _network: string = Network.MAINNET): Uint8Array {
  const scriptHash = hash160(scriptToBytecode(script));
  return new Uint8Array([
    0xa9, // OP_HASH160
    0x14, // push 20 bytes
    ...scriptHash,
    0x87, // OP_EQUAL
  ]);
}

/**
 * Helper function to convert a Radiant Base58Check address to its locking
 * script. Recognises both P2PKH (version 0x00 mainnet / 0x6f testnet+regtest)
 * and P2SH (version 0x05 / 0xc4) addresses and emits the matching standard
 * locking-bytecode template:
 *
 * - P2PKH: `OP_DUP OP_HASH160 <hash> OP_EQUALVERIFY OP_CHECKSIG`
 * - P2SH:  `OP_HASH160 <hash> OP_EQUAL`
 *
 * @param address  Base58Check address to convert to locking script
 * @returns        Locking-script bytecode corresponding to the address
 * @throws         If the address fails base58 decode or has an unknown version
 */
export function addressToLockScript(address: string): Uint8Array {
  const result = decodeBase58AddressFormat(sha256Adapter, address);
  if (typeof result === 'string') throw new Error(result);

  const { version, payload } = result;
  if (payload.byteLength !== 20) {
    throw new Error(`Invalid address "${address}": payload is ${payload.byteLength} bytes, expected 20`);
  }

  // P2PKH version bytes: 0x00 (mainnet) / 0x6f (testnet & regtest).
  if (version === 0x00 || version === 0x6f) {
    return new Uint8Array([
      0x76, // OP_DUP
      0xa9, // OP_HASH160
      0x14, // push 20 bytes
      ...payload,
      0x88, // OP_EQUALVERIFY
      0xac, // OP_CHECKSIG
    ]);
  }

  // P2SH version bytes: 0x05 (mainnet) / 0xc4 (testnet & regtest).
  if (version === 0x05 || version === 0xc4) {
    return new Uint8Array([
      0xa9, // OP_HASH160
      0x14, // push 20 bytes
      ...payload,
      0x87, // OP_EQUAL
    ]);
  }

  throw new Error(`Invalid address "${address}": unknown version byte 0x${version.toString(16).padStart(2, '0')}`);
}

/**
 * Returns the P2SH version byte for the given Radiant network.
 * Mainnet: 0x05 (P2SH), Testnet/Regtest: 0xc4 (196)
 */
export function getP2SHVersionByte(network: string): number {
  switch (network) {
    case Network.TESTNET:
    case Network.REGTEST:
      return 0xc4;
    case Network.MAINNET:
    default:
      return 0x05;
  }
}

// ////////////////////////////////////////////////////////////////////////////
// For encoding OP_RETURN data (doesn't require BIP62.3 / MINIMALDATA)
function encodeNullDataScript(chunks: (number | Uint8Array)[]): Uint8Array {
  return flattenBinArray(
    chunks.map((chunk) => {
      if (typeof chunk === 'number') {
        return new Uint8Array([chunk]);
      }

      const pushdataOpcode = getPushDataOpcode(chunk);
      return new Uint8Array([...pushdataOpcode, ...chunk]);
    }),
  );
}

function getPushDataOpcode(data: Uint8Array): Uint8Array {
  const { byteLength } = data;

  if (byteLength === 0) return Uint8Array.from([0x4c, 0x00]);
  if (byteLength < 76) return Uint8Array.from([byteLength]);
  if (byteLength < 256) return Uint8Array.from([0x4c, byteLength]);
  throw Error('Pushdata too large');
}
