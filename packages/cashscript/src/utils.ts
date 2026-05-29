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
} from './constants.js';
import {
  OutputSatoshisTooSmallError,
  Reason,
  FailedTransactionError,
  FailedRequireError,
  FailedTimeCheckError,
  FailedSigCheckError,
} from './Errors.js';

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

// ////////// SIZE CALCULATIONS ///////////////////////////////////////////////
export function getInputSize(inputScript: Uint8Array): number {
  const scriptSize = inputScript.byteLength;
  const varIntSize = scriptSize > 252 ? 3 : 1;
  return 32 + 4 + varIntSize + scriptSize + 4;
}

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
    if (typeof output.to === 'string') {
      return acc + P2PKH_OUTPUT_SIZE;
    }

    // Size of an OP_RETURN output = byteLength + 8 (amount) + 2 (scriptSize)
    return acc + output.to.byteLength + 8 + 2;
  }, 0);
  // Add tx-out count (accounting for a potential change output)
  size += encodeInt(outputs.length + 1).byteLength;

  return size;
}

// ////////// BUILD OBJECTS ///////////////////////////////////////////////////
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

  // Limit total pattern length to prevent excessive regex processing
  const MAX_PATTERN_LENGTH = 500;
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
