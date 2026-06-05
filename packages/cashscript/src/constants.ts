import { Network } from './interfaces.js';

export const P2PKH_OUTPUT_SIZE = 34;
export const P2SH_OUTPUT_SIZE = 32;
export const VERSION_SIZE = 4;
export const LOCKTIME_SIZE = 4;

// Dust limits per network (configurable)
// Based on 3x minimum relay fee * size of smallest output (34 bytes for P2PKH)
export const DUST_LIMIT_MAINNET = 546;
export const DUST_LIMIT_TESTNET = 546;
export const DUST_LIMIT_REGTEST = 546;

// Default dust limit for backward compatibility
export const DUST_LIMIT = DUST_LIMIT_MAINNET;

/**
 * Get dust limit for a specific network.
 * Accepts the Network enum or its underlying string literal for backwards compatibility.
 *
 * @param network The network type (Network.MAINNET | Network.TESTNET | Network.REGTEST)
 * @returns The dust limit in satoshis for that network
 */
export function getDustLimit(network: Network | string): number {
  switch (network) {
    case Network.MAINNET:
      return DUST_LIMIT_MAINNET;
    case Network.TESTNET:
      return DUST_LIMIT_TESTNET;
    case Network.REGTEST:
      return DUST_LIMIT_REGTEST;
    default:
      return DUST_LIMIT_MAINNET;
  }
}

// Security limits
export const MAX_FEE_SATOSHIS = 1000000; // 0.01 RXD maximum fee
export const MAX_TRANSACTION_SIZE = 100000; // 100KB transaction limit
export const MAX_INPUT_COUNT = 1000; // Reasonable input limit
export const MAX_OUTPUT_COUNT = 1000; // Reasonable output limit
export const MAX_SAFE_SATOSHIS = BigInt('0xFFFFFFFFFFFFFFFF'); // 64-bit unsigned max

/**
 * Radiant consensus money-range ceiling, in photons (satoshis).
 *
 * Unlike Bitcoin (`MAX_MONEY = 21,000,000 × COIN`), Radiant sets
 * `MAX_MONEY = Amount::max() = 2,100,000,000,000,000,000` photons
 * (21,000,000,000 RXD × 1e8) — see Radiant-Node `src/amount.h`. Any satoshi
 * value a transaction commits to must satisfy `0 ≤ v ≤ MAX_MONEY`; values
 * above this are non-consensus and are rejected by prevout verification.
 *
 * This exceeds `Number.MAX_SAFE_INTEGER` (≈9.007e15) so it is a bigint.
 */
export const MAX_MONEY = 2_100_000_000_000_000_000n;
