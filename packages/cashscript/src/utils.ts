import {
  binToHex,
  createTransactionContextCommon,
  bigIntToBinUint64LE,
  Transaction,
  generateSigningSerializationBCH,
  utf8ToBin,
  hexToBin,
  flattenBinArray,
  base58AddressToLockingBytecode,
  lockingBytecodeToBase58Address,
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

// ////////// PARAMETER VALIDATION ////////////////////////////////////////////
export function validateRecipient(recipient: Recipient): void {
  if (recipient.amount < DUST_LIMIT) {
    throw new OutputSatoshisTooSmallError(recipient.amount);
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
  const lockingBytecode = new Uint8Array([version, ...scriptHash]);
  const result = lockingBytecodeToBase58Address(lockingBytecode);
  if (typeof result === 'string') throw new Error(result);
  return result;
}

export function scriptToLockingBytecode(script: Script, network: string = Network.MAINNET): Uint8Array {
  const scriptHash = hash160(scriptToBytecode(script));
  const version = getP2SHVersionByte(network);
  return new Uint8Array([version, ...scriptHash]);
}

/**
* Helper function to convert a Radiant Base58Check address to a locking script
*
* @param address   Base58Check address to convert to locking script
*
* @returns a locking script corresponding to the passed address
*/
export function addressToLockScript(address: string): Uint8Array {
  const result = base58AddressToLockingBytecode(address);

  if (typeof result === 'string') throw new Error(result);

  return result.bytecode;
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
