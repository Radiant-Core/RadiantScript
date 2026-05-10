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
        pragma radiantscript ^0.7.0;

        contract P2PKH(pubkey owner) {
          return {
            spend(sig ownerSig) {
              require(checkSig(ownerSig, owner));
            }
          }
        }
      `;

      if (!compileString) {
        console.log('Skipping: rxdc not available');
        return;
      }
      const artifact = compileString(source);

      expect(artifact).toBeDefined();
      expect(artifact.contract).toBe('P2PKH');
      expect(typeof artifact.asm).toBe('string');
      expect(artifact.asm.length).toBeGreaterThan(0);
      const ctor = artifact.abi.find((f: any) => f.type === 'constructor');
      expect(ctor).toBeDefined();
      expect(ctor.params).toHaveLength(1);
      expect(ctor.params[0].name).toBe('owner');
      // Type names are emitted in TitleCase (e.g. PubKey, Sig, Int, Bytes).
      expect(ctor.params[0].type.toLowerCase()).toBe('pubkey');
    });

    it('should compile a contract with multiple functions', () => {
      const source = `
        pragma radiantscript ^0.7.0;

        contract MultiFunc(pubkey owner, int threshold) {
          return {
            spend(sig ownerSig) {
              require(checkSig(ownerSig, owner));
            },
            conditionalSpend(sig ownerSig, int amount) {
              require(amount >= threshold);
              require(checkSig(ownerSig, owner));
            }
          }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);

      expect(artifact.contract).toBe('MultiFunc');
      const fns = artifact.abi.filter((f: any) => f.type === 'function');
      expect(fns).toHaveLength(2);
      expect(fns.map((f: any) => f.name)).toContain('spend');
      expect(fns.map((f: any) => f.name)).toContain('conditionalSpend');
    });

    it('should compile a timelock contract', () => {
      const source = `
        pragma radiantscript ^0.7.0;

        contract TimeLock(pubkey recipient, int unlockTime) {
          return {
            claim(sig recipientSig) {
              require(tx.locktime >= unlockTime);
              require(checkSig(recipientSig, recipient));
            }
          }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);

      expect(artifact.contract).toBe('TimeLock');
      const ctor = artifact.abi.find((f: any) => f.type === 'constructor');
      expect(ctor.params).toHaveLength(2);
    });
  });

  describe('Token Contracts', () => {
    it('should compile a fungible token contract', () => {
      const source = `
        pragma radiantscript ^0.7.0;

        contract FungibleToken(pubkey mintAuthority) {
          return {
            transfer(sig ownerSig, pubkey ownerPk) {
              require(checkSig(ownerSig, ownerPk));
            },
            mint(sig authSig) {
              require(checkSig(authSig, mintAuthority));
            }
          }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);

      expect(artifact.contract).toBe('FungibleToken');
      const fns = artifact.abi.filter((f: any) => f.type === 'function');
      expect(fns).toHaveLength(2);
    });

    it('should compile an NFT contract', () => {
      const source = `
        pragma radiantscript ^0.7.0;

        contract NFT(pubkey creator) {
          return {
            transfer(sig ownerSig, pubkey ownerPk) {
              require(checkSig(ownerSig, ownerPk));
              require(creator.length > 0);
            },
            burn(sig ownerSig, pubkey ownerPk) {
              require(checkSig(ownerSig, ownerPk));
              require(creator.length > 0);
            }
          }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);

      expect(artifact.contract).toBe('NFT');
    });
  });

  describe('Error Handling', () => {
    it('should throw on syntax errors', () => {
      const invalidSource = `
        pragma radiantscript ^0.7.0;

        contract Invalid {
          return {
            broken( {
              require(true);
            }
          }
        }
      `;

      if (!compileString) return;
      const fn = compileString;
      expect(() => fn(invalidSource)).toThrow();
    });

    it('should throw on undefined variables', () => {
      const invalidSource = `
        pragma radiantscript ^0.7.0;

        contract UndefinedVar() {
          return {
            test(sig s) {
              require(checkSig(s, undefinedPubkey));
            }
          }
        }
      `;

      if (!compileString) return;
      const fn = compileString;
      expect(() => fn(invalidSource)).toThrow();
    });
  });

  describe('Artifact Structure', () => {
    it('should include compiler metadata', () => {
      const source = `
        pragma radiantscript ^0.7.0;
        contract Metadata() {
          return { test() { require(true); } }
        }
      `;

      if (!compileString) return;
      const artifact = compileString(source);

      expect(typeof artifact.compilerVersion).toBe('string');
      expect(artifact.compilerVersion.startsWith('rxdc ')).toBe(true);
      expect(typeof artifact.version).toBe('number');
    });

    it('should include source code when compiled with debug info', () => {
      const source = `
        pragma radiantscript ^0.7.0;
        contract WithSource() {
          return { test() { require(true); } }
        }
      `;

      if (!compileString) return;
      // compileString accepts an options object with `debug`; when omitted
      // the resulting artifact has no `source` / `sourceMap` fields by design.
      const fn = compileString as (s: string, opts?: { debug?: boolean }) => any;
      const artifact = fn(source, { debug: true });

      expect(artifact.source).toBeDefined();
      expect(artifact.source).toContain('WithSource');
    });
  });
});
