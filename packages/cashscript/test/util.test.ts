import { binToHex, decodeBase58AddressFormat } from '@bitauth/libauth';
import {
  asmToBytecode,
  asmToScript,
  bytecodeToAsm,
  hash160,
  placeholder,
  scriptToBytecode,
  sha256,
} from '@radiantscript/utils';
import {
  scriptToAddress,
  createInputScript,
  getInputSize,
  getPreimageSize,
} from '../src/utils.js';
import { Network } from '../src/interfaces.js';
import * as fixtures from './fixture/vars.js';

describe('utils', () => {
  beforeAll(async () => fixtures.initFixtures());
  // Resolve at test time so we pick up the values populated by `initFixtures`.
  const alicePk = (): Uint8Array => fixtures.alicePk;
  const alicePkh = (): Uint8Array => fixtures.alicePkh;
  describe('getInputSize', () => {
    it('should calculate input size for small script', () => {
      const inputScript = new Uint8Array(100).fill(0);

      const size = getInputSize(inputScript);

      const expectedSize = 100 + 40 + 1;
      expect(size).toEqual(expectedSize);
    });

    it('should calculate input size for large script', () => {
      const inputScript = new Uint8Array(255).fill(0);

      const size = getInputSize(inputScript);

      const expectedSize = 255 + 40 + 3;
      expect(size).toEqual(expectedSize);
    });
  });

  describe('getPreimageSize', () => {
    it('should calculate preimage size for small script', () => {
      const inputScript = new Uint8Array(100).fill(0);

      const size = getPreimageSize(inputScript);

      const expectedSize = 100 + 156 + 1;
      expect(size).toEqual(expectedSize);
    });

    it('should calculate preimage size for large script', () => {
      const inputScript = new Uint8Array(255).fill(0);

      const size = getPreimageSize(inputScript);

      const expectedSize = 255 + 156 + 3;
      expect(size).toEqual(expectedSize);
    });
  });

  describe('createInputScript', () => {
    it('should create an input script without selector or preimage', () => {
      const asm = `${binToHex(alicePkh())} OP_OVER OP_HASH160 OP_EQUALVERIFY OP_CHECKSIG`;
      const redeemScript = asmToScript(asm);
      const args = [alicePk(), placeholder(1)];

      const inputScript = createInputScript(redeemScript, args);

      const expectedInputScriptAsm = `00 ${binToHex(alicePk())} ${binToHex(asmToBytecode(asm))}`;
      expect(bytecodeToAsm(inputScript)).toEqual(expectedInputScriptAsm);
    });

    it('should create an input script with selector and preimage', () => {
      const asm = `${binToHex(alicePkh())} OP_OVER OP_HASH160 OP_EQUALVERIFY OP_CHECKSIG`;
      const redeemScript = asmToScript(asm);
      const args = [alicePk(), placeholder(1)];
      const selector = 1;
      const preimage = placeholder(1);

      const inputScript = createInputScript(redeemScript, args, selector, preimage);

      const expectedInputScriptAsm = `00 ${binToHex(alicePk())} 00 OP_1 ${binToHex(asmToBytecode(asm))}`;
      expect(bytecodeToAsm(inputScript)).toEqual(expectedInputScriptAsm);
    });
  });

  describe('scriptToAddress', () => {
    // Radiant uses Bitcoin's base58check addressing (no cashaddr / no
    // bech32 / no prefix). Round-trip is the right correctness check —
    // round-trip is robust to changes in the fixture key material and
    // verifies both encoder and decoder agree.
    it('round-trips a redeem script through each network', () => {
      const asm = `${binToHex(alicePkh())} OP_OVER OP_HASH160 OP_EQUALVERIFY OP_CHECKSIG`;
      const redeemScript = asmToScript(asm);
      const expectedHash = hash160(scriptToBytecode(redeemScript));

      const networks: Array<[Network, number, RegExp]> = [
        [Network.MAINNET, 0x05, /^3/],   // P2SH mainnet starts with '3'
        [Network.TESTNET, 0xc4, /^2/],   // P2SH testnet/regtest starts with '2'
        [Network.REGTEST, 0xc4, /^2/],
      ];

      for (const [network, expectedVersion, addressPrefix] of networks) {
        const address = scriptToAddress(redeemScript, network);
        expect(address).toMatch(addressPrefix);

        const decoded = decodeBase58AddressFormat(
          { hash: (input: Uint8Array) => sha256(input) },
          address,
        );
        if (typeof decoded === 'string') throw new Error(decoded);
        expect(decoded.version).toEqual(expectedVersion);
        expect(decoded.payload).toEqual(expectedHash);
      }
    });

    it('produces different addresses on mainnet vs testnet for the same script', () => {
      const asm = `${binToHex(alicePkh())} OP_OVER OP_HASH160 OP_EQUALVERIFY OP_CHECKSIG`;
      const redeemScript = asmToScript(asm);

      expect(scriptToAddress(redeemScript, Network.MAINNET))
        .not.toEqual(scriptToAddress(redeemScript, Network.TESTNET));
    });
  });
});
