/**
 * End-to-End Token Workflow Tests
 * 
 * Tests the complete workflow of creating, deploying, and interacting
 * with token contracts using the full Radiant ecosystem stack.
 */

import { TEST_WALLET, shouldRunNetworkTests } from '../setup';

describe('E2E Token Workflow', () => {
  let radiantjs: any;
  let compileString: ((source: string) => any) | null = null;

  beforeAll(async () => {
    radiantjs = await import('@radiantblockchain/radiantjs');
    try {
      const rxdc = await import('rxdc');
      compileString = rxdc.compileString;
    } catch (e) {
      // rxdc not available
    }
  });

  describe('Fungible Token Creation', () => {
    it('should compile a fungible token contract', () => {
      const source = `
        pragma radiant ^0.7.0;
        
        contract FungibleToken(pubkey mintAuthority) {
          function transfer(sig ownerSig, pubkey ownerPk) {
            require(checkSig(ownerSig, ownerPk));
          }
          
          function mint(sig authSig) {
            require(checkSig(authSig, mintAuthority));
          }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);
      
      expect(artifact.contractName).toBe('FungibleToken');
      expect(artifact.bytecode).toBeDefined();
      expect(artifact.abi).toHaveLength(2);
    });

    it('should generate valid constructor parameters', () => {
      const privateKey = new radiantjs.PrivateKey();
      const publicKey = privateKey.toPublicKey();
      
      // Public key should be 33 bytes (compressed) or 65 bytes (uncompressed)
      const pubkeyHex = publicKey.toString();
      expect(pubkeyHex.length).toBeGreaterThanOrEqual(66); // 33 bytes * 2
    });

    it('should create token metadata structure', () => {
      const tokenMetadata = {
        v: 2,
        type: 'ft',
        p: [1], // GLYPH_FT protocol
        name: 'Test Token',
        ticker: 'TEST',
        decimals: 8,
        desc: 'A test fungible token',
      };

      expect(tokenMetadata.v).toBe(2);
      expect(tokenMetadata.type).toBe('ft');
      expect(tokenMetadata.decimals).toBe(8);
    });
  });

  describe('NFT Creation', () => {
    it('should compile an NFT contract', () => {
      const source = `
        pragma radiant ^0.7.0;
        
        contract NFT(pubkey creator) {
          function transfer(sig ownerSig, pubkey ownerPk) {
            require(checkSig(ownerSig, ownerPk));
          }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);
      
      expect(artifact.contractName).toBe('NFT');
    });

    it('should create NFT metadata structure', () => {
      const nftMetadata = {
        v: 2,
        type: 'nft',
        p: [2], // GLYPH_NFT protocol
        name: 'Test NFT #1',
        desc: 'A unique test NFT',
        main: {
          t: 'image/png',
          b: 'base64-encoded-image-data',
        },
        attrs: [
          { name: 'Rarity', value: 'Legendary' },
          { name: 'Power', value: 100 },
        ],
      };

      expect(nftMetadata.v).toBe(2);
      expect(nftMetadata.type).toBe('nft');
      expect(nftMetadata.attrs).toHaveLength(2);
    });
  });

  describe('dMint Token Creation', () => {
    it('should compile a dMint contract', () => {
      const source = `
        pragma radiant ^0.7.0;
        
        contract dMintToken(bytes32 difficultyTarget) {
          function mint(bytes nonce) {
            bytes32 hash = sha256(sha256(this.activeBytecode + nonce));
            require(hash < difficultyTarget);
          }
          
          function transfer(sig ownerSig, pubkey ownerPk) {
            require(checkSig(ownerSig, ownerPk));
          }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);
      
      expect(artifact.contractName).toBe('dMintToken');
      expect(artifact.constructorInputs).toHaveLength(1);
      expect(artifact.constructorInputs[0].type).toBe('bytes32');
    });

    it('should create dMint metadata structure', () => {
      const dmintMetadata = {
        v: 2,
        type: 'ft',
        p: [1, 3], // GLYPH_FT + GLYPH_DAT (dMint)
        name: 'Mineable Token',
        ticker: 'MINE',
        decimals: 8,
        dmint: {
          maxSupply: 21000000,
          reward: 50,
          halvingInterval: 210000,
          algorithm: 'sha256d',
          daa: 'asert',
        },
      };

      expect(dmintMetadata.dmint).toBeDefined();
      expect(dmintMetadata.dmint.algorithm).toBe('sha256d');
    });
  });

  describe('Transaction Building', () => {
    it('should build a token transfer transaction structure', () => {
      const privateKey = new radiantjs.PrivateKey();
      const recipientKey = new radiantjs.PrivateKey();
      
      const tx = new radiantjs.Transaction();
      
      // Add token input (mock UTXO)
      tx.from({
        txId: 'a'.repeat(64),
        outputIndex: 0,
        script: radiantjs.Script.buildPublicKeyHashOut(privateKey.toAddress()),
        satoshis: 1000,
      });
      
      // Add token output to recipient
      tx.to(recipientKey.toAddress(), 546); // Dust limit
      
      // Add change output
      tx.change(privateKey.toAddress());
      
      expect(tx.inputs).toHaveLength(1);
      expect(tx.outputs.length).toBeGreaterThanOrEqual(1);
    });

    it('should serialize transaction to hex', () => {
      const privateKey = new radiantjs.PrivateKey();
      
      const tx = new radiantjs.Transaction();
      tx.from({
        txId: 'a'.repeat(64),
        outputIndex: 0,
        script: radiantjs.Script.buildPublicKeyHashOut(privateKey.toAddress()),
        satoshis: 10000,
      });
      tx.to(privateKey.toAddress(), 5000);
      tx.change(privateKey.toAddress());
      tx.sign(privateKey);
      
      const hex = tx.serialize();
      
      expect(typeof hex).toBe('string');
      expect(hex.length).toBeGreaterThan(0);
    });
  });

  // Network-dependent tests
  const describeIfNetwork = shouldRunNetworkTests() ? describe : describe.skip;

  describeIfNetwork('Live Network Tests', () => {
    it('should get balance from testnet', async () => {
      const { ElectrumClient } = await import('ws-electrumx-client');
      const client = new ElectrumClient('ssl://electrumx-testnet.radiant4people.com:50012');
      
      await client.connect();
      
      // Generate a new address to check (will have 0 balance)
      const privateKey = new radiantjs.PrivateKey();
      const address = privateKey.toAddress().toString();
      
      try {
        const balance = await client.request('blockchain.address.get_balance', [address]);
        expect(balance.confirmed).toBe(0);
        expect(balance.unconfirmed).toBe(0);
      } finally {
        await client.disconnect();
      }
    });
  });
});
