/**
 * GlyphV2FT Integration Example
 * 
 * Demonstrates using radiantjs and radiantblockchain-constants
 * to interact with GlyphV2FT.rxd contracts.
 * 
 * Dependencies:
 *   npm install @radiantblockchain/radiantjs @radiantblockchain/constants
 */

import {
  PrivateKey,
  Transaction,
  Script,
  Address,
  // @ts-ignore - Glyph module
  Glyph,
} from '@radiantblockchain/radiantjs';

import {
  GlyphProtocol,
  GlyphVersion,
  DmintAlgorithm,
  DaaMode,
  GlyphLimits,
  validateProtocols,
  getProtocolName,
} from '@radiantblockchain/constants';

// ============================================================
// Token Metadata Creation
// ============================================================

/**
 * Create Glyph v2 FT metadata
 */
function createFTMetadata(options: {
  ticker: string;
  name: string;
  decimals?: number;
  maxSupply?: bigint;
  description?: string;
}) {
  const metadata = {
    v: GlyphVersion.V2,
    type: 'token',
    p: [GlyphProtocol.GLYPH_FT],
    ticker: options.ticker,
    name: options.name,
    decimals: options.decimals ?? 8,
    ...(options.maxSupply && { max: options.maxSupply.toString() }),
    ...(options.description && { desc: options.description }),
  };

  // Validate protocols
  const validation = validateProtocols(metadata.p);
  if (!validation.valid) {
    throw new Error(`Invalid protocols: ${validation.error}`);
  }

  return metadata;
}

/**
 * Create Glyph v2 dMint FT metadata
 */
function createDmintMetadata(options: {
  ticker: string;
  name: string;
  decimals?: number;
  maxSupply: bigint;
  reward: bigint;
  algorithm?: number;
  daaMode?: number;
  difficulty?: bigint;
}) {
  const metadata = {
    v: GlyphVersion.V2,
    type: 'token',
    p: [GlyphProtocol.GLYPH_FT, GlyphProtocol.GLYPH_DMINT],
    ticker: options.ticker,
    name: options.name,
    decimals: options.decimals ?? 8,
    dmint: {
      max: options.maxSupply.toString(),
      reward: options.reward.toString(),
      algo: options.algorithm ?? DmintAlgorithm.SHA256D,
      daa: options.daaMode ?? DaaMode.FIXED,
      ...(options.difficulty && { diff: options.difficulty.toString() }),
    },
  };

  // Validate protocols
  const validation = validateProtocols(metadata.p);
  if (!validation.valid) {
    throw new Error(`Invalid protocols: ${validation.error}`);
  }

  return metadata;
}

// ============================================================
// Transaction Building
// ============================================================

/**
 * Build a token transfer transaction
 */
async function buildTransferTx(params: {
  privateKey: PrivateKey;
  utxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>;
  tokenRef: string;
  recipients: Array<{ address: string; amount: bigint }>;
}) {
  const tx = new Transaction();

  // Add inputs
  for (const utxo of params.utxos) {
    tx.from({
      txId: utxo.txid,
      outputIndex: utxo.vout,
      satoshis: utxo.satoshis,
      script: utxo.script,
    });
  }

  // Add token outputs for each recipient
  for (const recipient of params.recipients) {
    const address = Address.fromString(recipient.address);
    tx.to(address, Number(recipient.amount));
  }

  // Sign transaction
  tx.sign(params.privateKey);

  return tx;
}

/**
 * Build a token burn transaction
 */
async function buildBurnTx(params: {
  privateKey: PrivateKey;
  utxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>;
  tokenRef: string;
  burnAmount: bigint;
  changeAddress: string;
}) {
  const tx = new Transaction();

  // Add inputs
  let totalInput = 0n;
  for (const utxo of params.utxos) {
    tx.from({
      txId: utxo.txid,
      outputIndex: utxo.vout,
      satoshis: utxo.satoshis,
      script: utxo.script,
    });
    totalInput += BigInt(utxo.satoshis);
  }

  // Calculate change (input - burn)
  const changeAmount = totalInput - params.burnAmount;
  if (changeAmount > 0n) {
    const changeAddr = Address.fromString(params.changeAddress);
    tx.to(changeAddr, Number(changeAmount));
  }

  // Sign transaction
  tx.sign(params.privateKey);

  return tx;
}

// ============================================================
// Metadata Encoding
// ============================================================

/**
 * Encode metadata for commit transaction
 */
function encodeCommit(metadata: object): { commitHash: Buffer; envelope: Buffer } {
  const commitHash = Glyph.computeCommitHash(metadata);
  const envelope = Glyph.encodeCommitEnvelope({ commitHash });
  return { commitHash, envelope };
}

/**
 * Encode metadata for reveal transaction
 */
function encodeReveal(metadata: object, files?: Buffer[]): Buffer[] {
  return Glyph.encodeRevealEnvelope({ metadata, files });
}

// ============================================================
// Usage Example
// ============================================================

async function main() {
  console.log('=== Glyph v2 FT Integration Example ===\n');

  // 1. Create FT metadata
  const ftMetadata = createFTMetadata({
    ticker: 'TEST',
    name: 'Test Token',
    decimals: 8,
    maxSupply: 21_000_000n * 100_000_000n, // 21M with 8 decimals
    description: 'A test fungible token using Glyph v2',
  });

  console.log('FT Metadata:');
  console.log(JSON.stringify(ftMetadata, null, 2));
  console.log();

  // 2. Create dMint metadata
  const dmintMetadata = createDmintMetadata({
    ticker: 'MINE',
    name: 'Mineable Token',
    decimals: 8,
    maxSupply: 100_000_000n * 100_000_000n,
    reward: 50n * 100_000_000n,
    algorithm: DmintAlgorithm.BLAKE3,
    daaMode: DaaMode.ASERT,
  });

  console.log('dMint Metadata:');
  console.log(JSON.stringify(dmintMetadata, null, 2));
  console.log();

  // 3. Protocol information
  console.log('Protocol Names:');
  for (const p of dmintMetadata.p) {
    console.log(`  ${p}: ${getProtocolName(p)}`);
  }
  console.log();

  // 4. Size validation
  const metadataJson = JSON.stringify(ftMetadata);
  const size = Buffer.from(metadataJson).length;
  console.log(`Metadata size: ${size} bytes`);
  console.log(`Max allowed: ${GlyphLimits.MAX_METADATA_SIZE} bytes`);
  console.log(`Within limits: ${size <= GlyphLimits.MAX_METADATA_SIZE}`);
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export {
  createFTMetadata,
  createDmintMetadata,
  buildTransferTx,
  buildBurnTx,
  encodeCommit,
  encodeReveal,
};
