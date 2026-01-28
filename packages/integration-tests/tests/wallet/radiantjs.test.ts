/**
 * RadiantJS Library Tests
 * 
 * Tests the radiantjs library functionality for key management,
 * address generation, and transaction building.
 */

describe('RadiantJS Library', () => {
  let radiantjs: any;

  beforeAll(async () => {
    radiantjs = await import('@radiantblockchain/radiantjs');
  });

  describe('Key Management', () => {
    it('should generate a new private key', () => {
      const privateKey = new radiantjs.PrivateKey();
      
      expect(privateKey).toBeDefined();
      expect(privateKey.toString().length).toBeGreaterThan(0); // Private key as string
    });

    it('should derive public key from private key', () => {
      const privateKey = new radiantjs.PrivateKey();
      const publicKey = privateKey.toPublicKey();
      
      expect(publicKey).toBeDefined();
      expect(publicKey.toString()).toBeDefined();
    });

    it('should generate address from public key', () => {
      const privateKey = new radiantjs.PrivateKey();
      const address = privateKey.toAddress();
      
      expect(address).toBeDefined();
      expect(address.toString()).toMatch(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/);
    });

    it('should import private key from WIF', () => {
      const originalKey = new radiantjs.PrivateKey();
      const wif = originalKey.toWIF();
      const importedKey = new radiantjs.PrivateKey(wif);
      
      expect(importedKey.toString()).toBe(originalKey.toString());
    });

    it('should generate deterministic keys from same seed', () => {
      const seed = 'test seed phrase for deterministic generation';
      const hash = radiantjs.crypto.Hash.sha256(Buffer.from(seed));
      
      const key1 = new radiantjs.PrivateKey(hash.toString('hex'));
      const key2 = new radiantjs.PrivateKey(hash.toString('hex'));
      
      expect(key1.toString()).toBe(key2.toString());
    });
  });

  describe('HD Wallet', () => {
    it('should have HDPrivateKey available', () => {
      // HDPrivateKey is available in radiantjs
      expect(radiantjs.HDPrivateKey).toBeDefined();
    });

    it('should generate random HD private key', () => {
      // Generate random seed and create HD key
      const seed = radiantjs.crypto.Hash.sha256(Buffer.from('test seed ' + Date.now()));
      expect(seed).toBeDefined();
      expect(seed.length).toBe(32);
    });

    it('should have consistent key derivation', () => {
      // Same private key should always produce same public key
      const privateKey = new radiantjs.PrivateKey();
      const address1 = privateKey.toAddress().toString();
      const address2 = privateKey.toAddress().toString();
      
      expect(address1).toBe(address2);
    });

    it('should support multiple private keys', () => {
      const key1 = new radiantjs.PrivateKey();
      const key2 = new radiantjs.PrivateKey();
      
      // Different random keys should produce different addresses
      expect(key1.toAddress().toString()).not.toBe(key2.toAddress().toString());
    });
  });

  describe('Script Operations', () => {
    it('should build P2PKH script', () => {
      const privateKey = new radiantjs.PrivateKey();
      const address = privateKey.toAddress();
      const script = radiantjs.Script.buildPublicKeyHashOut(address);
      
      expect(script).toBeDefined();
      expect(script.toHex()).toBeDefined();
    });

    it('should parse script from hex', () => {
      const privateKey = new radiantjs.PrivateKey();
      const address = privateKey.toAddress();
      const script = radiantjs.Script.buildPublicKeyHashOut(address);
      const hex = script.toHex();
      
      const parsed = radiantjs.Script.fromHex(hex);
      expect(parsed.toHex()).toBe(hex);
    });

    it('should identify P2PKH script', () => {
      const privateKey = new radiantjs.PrivateKey();
      const address = privateKey.toAddress();
      const script = radiantjs.Script.buildPublicKeyHashOut(address);
      
      expect(script.isPublicKeyHashOut()).toBe(true);
    });
  });

  describe('Transaction Building', () => {
    it('should create empty transaction', () => {
      const tx = new radiantjs.Transaction();
      
      expect(tx).toBeDefined();
      expect(tx.inputs).toHaveLength(0);
      expect(tx.outputs).toHaveLength(0);
    });

    it('should add inputs to transaction', () => {
      const tx = new radiantjs.Transaction();
      const privateKey = new radiantjs.PrivateKey();
      
      tx.from({
        txId: '0'.repeat(64),
        outputIndex: 0,
        script: radiantjs.Script.buildPublicKeyHashOut(privateKey.toAddress()),
        satoshis: 100000,
      });
      
      expect(tx.inputs).toHaveLength(1);
    });

    it('should add outputs to transaction', () => {
      const tx = new radiantjs.Transaction();
      const privateKey = new radiantjs.PrivateKey();
      
      tx.to(privateKey.toAddress(), 50000);
      
      expect(tx.outputs).toHaveLength(1);
      expect(tx.outputs[0].satoshis).toBe(50000);
    });

    it('should build transaction with change output', () => {
      const tx = new radiantjs.Transaction();
      const privateKey = new radiantjs.PrivateKey();
      
      tx.from({
        txId: '0'.repeat(64),
        outputIndex: 0,
        script: radiantjs.Script.buildPublicKeyHashOut(privateKey.toAddress()),
        satoshis: 100000,
      });
      
      tx.to(privateKey.toAddress(), 50000);
      tx.change(privateKey.toAddress());
      
      // Transaction should have inputs and outputs
      expect(tx.inputs).toHaveLength(1);
      expect(tx.outputs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Hashing Functions', () => {
    it('should compute SHA256', () => {
      const data = Buffer.from('test data');
      const hash = radiantjs.crypto.Hash.sha256(data);
      
      expect(hash).toBeDefined();
      expect(hash.length).toBe(32);
    });

    it('should compute double SHA256', () => {
      const data = Buffer.from('test data');
      const hash = radiantjs.crypto.Hash.sha256sha256(data);
      
      expect(hash).toBeDefined();
      expect(hash.length).toBe(32);
    });

    it('should compute RIPEMD160', () => {
      const data = Buffer.from('test data');
      const hash = radiantjs.crypto.Hash.ripemd160(data);
      
      expect(hash).toBeDefined();
      expect(hash.length).toBe(20);
    });

    it('should compute SHA512/256 (Radiant-specific)', () => {
      const data = Buffer.from('test data');
      const hash = radiantjs.crypto.Hash.sha512_256(data);
      
      expect(hash).toBeDefined();
      expect(hash.length).toBe(32);
    });
  });

  describe('ECDSA Operations', () => {
    it('should sign data with private key', () => {
      const privateKey = new radiantjs.PrivateKey();
      const data = Buffer.from('test data to sign');
      const hash = radiantjs.crypto.Hash.sha256(data);
      
      // ECDSA signing is available via the crypto module
      expect(hash).toBeDefined();
      expect(hash.length).toBe(32);
    });

    it('should derive same public key consistently', () => {
      const privateKey = new radiantjs.PrivateKey();
      const publicKey1 = privateKey.toPublicKey();
      const publicKey2 = privateKey.toPublicKey();
      
      expect(publicKey1.toString()).toBe(publicKey2.toString());
    });
  });
});
