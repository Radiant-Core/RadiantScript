import { hexToBin } from '@bitauth/libauth';
import {
  BytesType,
  encodeBool,
  encodeInt,
  encodeString,
  parseType,
  PrimitiveType,
} from '@radiantscript/utils';
import { TypeError } from './Errors.js';
import SignatureTemplate from './SignatureTemplate.js';

export type Argument = number | bigint | boolean | string | Uint8Array | SignatureTemplate;

export function encodeArgument(
  argument: Argument,
  typeStr: string,
): Uint8Array | SignatureTemplate {
  let type = parseType(typeStr);

  if (type === PrimitiveType.BOOL) {
    if (typeof argument !== 'boolean') {
      throw new TypeError(typeof argument, type);
    }
    return encodeBool(argument);
  }

  if (type === PrimitiveType.INT) {
    if (typeof argument !== 'number' && typeof argument !== 'bigint') {
      throw new TypeError(typeof argument, type);
    }
    return encodeInt(argument);
  }

  if (type === PrimitiveType.STRING) {
    if (typeof argument !== 'string') {
      throw new TypeError(typeof argument, type);
    }
    return encodeString(argument);
  }

  if (type === PrimitiveType.SIG && argument instanceof SignatureTemplate) return argument;

  // Convert hex string to Uint8Array with validation
  if (typeof argument === 'string') {
    // Validate hex string format
    if (!/^0x?[0-9a-fA-F]*$/.test(argument)) {
      throw new TypeError(`Invalid hex string format: ${argument.substring(0, 20)}...`);
    }

    // Check for reasonable hex string length (prevent DoS)
    const MAX_HEX_LENGTH = 10000; // 5KB max
    if (argument.length > MAX_HEX_LENGTH) {
      throw new TypeError(`Hex string too long: ${argument.length} characters exceeds maximum ${MAX_HEX_LENGTH}`);
    }

    if (argument.startsWith('0x')) {
      argument = argument.slice(2);
    }

    // Must be even length for valid hex
    if (argument.length % 2 !== 0) {
      throw new TypeError(`Invalid hex string: odd length ${argument.length}`);
    }

    argument = hexToBin(argument);
  }

  if (!(argument instanceof Uint8Array)) {
    throw Error(`Value for type ${type} should be a Uint8Array or hex string`);
  }

  // Validate Uint8Array size limits
  const MAX_BYTES_SIZE = 520; // Bitcoin script push limit
  if (argument.byteLength > MAX_BYTES_SIZE) {
    throw new TypeError(`Byte array too large: ${argument.byteLength} bytes exceeds maximum ${MAX_BYTES_SIZE}`);
  }

  // Redefine SIG as a bytes65 so it is included in the size checks below
  // Note that ONLY Schnorr signatures are accepted
  if (type === PrimitiveType.SIG && argument.byteLength !== 0) {
    type = new BytesType(65);
  }

  // Redefine SIG as a bytes64 so it is included in the size checks below
  // Note that ONLY Schnorr signatures are accepted
  if (type === PrimitiveType.DATASIG && argument.byteLength !== 0) {
    type = new BytesType(64);
  }

  // Bounded bytes types require a correctly sized argument
  if (type instanceof BytesType && type.bound && argument.byteLength !== type.bound) {
    throw new TypeError(`bytes${argument.byteLength}`, type);
  }

  return argument;
}
