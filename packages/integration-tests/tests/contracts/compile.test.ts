/**
 * Contract Compilation Tests
 * 
 * Tests the RadiantScript compiler (rxdc) functionality.
 * Skips tests if rxdc is not available.
 */

describe('Contract Compilation', () => {
  let compileString: ((source: string) => any) | null = null;

  beforeAll(async () => {
    try {
      const rxdc = await import('rxdc');
      compileString = rxdc.compileString;
    } catch (e) {
      // rxdc not available
    }
  });

  describe('Basic Contracts', () => {
    it('should compile a simple P2PKH-like contract', () => {
      const source = `
        pragma radiant ^0.7.0;
        
        contract P2PKH(pubkey owner) {
          function spend(sig ownerSig) {
            require(checkSig(ownerSig, owner));
          }
        }
      `;

      if (!compileString) {
        console.log('Skipping: rxdc not available');
        return;
      }
      const artifact = compileString(source);
      
      expect(artifact).toBeDefined();
      expect(artifact.contractName).toBe('P2PKH');
      expect(artifact.bytecode).toBeDefined();
      expect(artifact.bytecode.length).toBeGreaterThan(0);
      expect(artifact.constructorInputs).toHaveLength(1);
      expect(artifact.constructorInputs[0].name).toBe('owner');
      expect(artifact.constructorInputs[0].type).toBe('pubkey');
    });

    it('should compile a contract with multiple functions', () => {
      const source = `
        pragma radiant ^0.7.0;
        
        contract MultiFunc(pubkey owner, int threshold) {
          function spend(sig ownerSig) {
            require(checkSig(ownerSig, owner));
          }
          
          function conditionalSpend(sig ownerSig, int amount) {
            require(amount >= threshold);
            require(checkSig(ownerSig, owner));
          }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);
      
      expect(artifact.contractName).toBe('MultiFunc');
      expect(artifact.abi).toHaveLength(2);
      expect(artifact.abi.map((f: any) => f.name)).toContain('spend');
      expect(artifact.abi.map((f: any) => f.name)).toContain('conditionalSpend');
    });

    it('should compile a timelock contract', () => {
      const source = `
        pragma radiant ^0.7.0;
        
        contract TimeLock(pubkey recipient, int unlockTime) {
          function claim(sig recipientSig) {
            require(tx.locktime >= unlockTime);
            require(checkSig(recipientSig, recipient));
          }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);
      
      expect(artifact.contractName).toBe('TimeLock');
      expect(artifact.constructorInputs).toHaveLength(2);
    });
  });

  describe('Token Contracts', () => {
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
      expect(artifact.abi).toHaveLength(2);
    });

    it('should compile an NFT contract', () => {
      const source = `
        pragma radiant ^0.7.0;
        
        contract NFT(pubkey creator) {
          function transfer(sig ownerSig, pubkey ownerPk) {
            require(checkSig(ownerSig, ownerPk));
          }
          
          function burn(sig ownerSig, pubkey ownerPk) {
            require(checkSig(ownerSig, ownerPk));
          }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);
      
      expect(artifact.contractName).toBe('NFT');
    });
  });

  describe('Error Handling', () => {
    it('should throw on syntax errors', () => {
      const invalidSource = `
        pragma radiant ^0.7.0;
        
        contract Invalid {
          function broken( {
            require(true);
          }
        }
      `;

      if (!compileString) return;
      expect(() => compileString(invalidSource)).toThrow();
    });

    it('should throw on undefined variables', () => {
      const invalidSource = `
        pragma radiant ^0.7.0;
        
        contract UndefinedVar() {
          function test(sig s) {
            require(checkSig(s, undefinedPubkey));
          }
        }
      `;

      if (!compileString) return;
      expect(() => compileString(invalidSource)).toThrow();
    });
  });

  describe('Artifact Structure', () => {
    it('should include compiler metadata', () => {
      const source = `
        pragma radiant ^0.7.0;
        contract Metadata() {
          function test() { require(true); }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);
      
      expect(artifact.compiler).toBeDefined();
      expect(artifact.compiler.name).toBe('rxdc');
      expect(artifact.compiler.version).toBeDefined();
      expect(artifact.updatedAt).toBeDefined();
    });

    it('should include source code', () => {
      const source = `
        pragma radiant ^0.7.0;
        contract WithSource() {
          function test() { require(true); }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);
      
      expect(artifact.source).toBeDefined();
      expect(artifact.source).toContain('WithSource');
    });
  });
});
