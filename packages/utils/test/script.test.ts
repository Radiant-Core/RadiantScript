import { hexToBin, utf8ToBin } from '@bitauth/libauth';
import {
  asmToBytecode,
  asmToScript,
  bytecodeToAsm,
  bytecodeToScript,
  calculateBytesize,
  countOpcodes,
  encodeNullDataScript,
  Op,
  replaceBytecodeNop,
  scriptToAsm,
  scriptToBytecode,
} from '../src/index.js';
import { fixtures } from './script.fixture.js';

describe('script utils', () => {
  describe('scriptToAsm()', () => {
    fixtures.forEach(({ name, script, asm }) => {
      it(`should convert script to asm for "${name}"`, () => {
        expect(scriptToAsm(script)).toEqual(asm);
      });
    });
  });

  describe('asmToScript()', () => {
    fixtures.forEach(({ name, script, asm }) => {
      it(`should convert asm to script for "${name}"`, () => {
        expect(asmToScript(asm)).toEqual(script);
      });
    });
  });

  describe('scriptToBytecode()', () => {
    fixtures.forEach(({ name, script, bytecode }) => {
      it(`should convert script to bytecode for "${name}"`, () => {
        expect(scriptToBytecode(script)).toEqual(bytecode);
      });
    });
  });

  describe('bytecodeToScript()', () => {
    fixtures.forEach(({ name, script, bytecode }) => {
      it(`should convert bytecode to script for "${name}"`, () => {
        expect(bytecodeToScript(bytecode)).toEqual(script);
      });
    });
  });

  describe('asmToBytecode()', () => {
    fixtures.forEach(({ name, asm, bytecode }) => {
      it(`should convert asm to bytecode for "${name}"`, () => {
        expect(asmToBytecode(asm)).toEqual(bytecode);
      });
    });
  });

  describe('bytecodeToAsm()', () => {
    fixtures.forEach(({ name, asm, bytecode }) => {
      it(`should convert bytecode to asm for "${name}"`, () => {
        expect(bytecodeToAsm(bytecode)).toEqual(asm);
      });
    });
  });

  describe('countOpcodes()', () => {
    fixtures.forEach(({ name, script, opcount }) => {
      it(`should count opcodes for "${name}"`, () => {
        expect(countOpcodes(script)).toEqual(opcount);
      });
    });
  });

  describe('calculateBytesize()', () => {
    fixtures.forEach(({ name, script, bytesize }) => {
      it(`should count opcodes for "${name}"`, () => {
        expect(calculateBytesize(script)).toEqual(bytesize);
      });
    });
  });

  describe('encodeNullDataScript()', () => {
    it('should encode an SLP genesis', () => {
      const input = [
        hexToBin('534c5000'),
        hexToBin('01'),
        utf8ToBin('GENESIS'),
        utf8ToBin('CSS'),
        utf8ToBin('CashScriptSLP'),
        utf8ToBin('https://cashscript.org/'),
        utf8ToBin(''),
        hexToBin('08'),
        hexToBin('02'),
        hexToBin('0000000000000001'),
      ];

      const output = hexToBin('04534c500001010747454e45534953034353530d43617368536372697074534c501768747470733a2f2f636173687363726970742e6f72672f4c0001080102080000000000000001');

      expect(encodeNullDataScript(input)).toEqual(output);
    });
  });

  describe('replaceBytecodeNop()', () => {
    // Helper: build a script consisting of [OP_NOP, cutSizeOp, ...filler].
    // The function under test removes the OP_NOP, reads `cutSizeOp` as an
    // integer cut, and patches it to cutSizeOp + 1 (or +3 if the resulting
    // bytecode is > 252 bytes — the boundary between single-byte and
    // 3-byte VarInt encoding of the redeem-script length).
    function makeScript(cutSize: number, fillerBytes: number): import('../src/index.js').Script {
      const filler: Uint8Array[] = [];
      // Each push of <= 75 bytes costs `1 + N` bytes in serialized form.
      // We use 75-byte pushes so we can dial bytecode size precisely.
      let remaining = fillerBytes;
      while (remaining > 0) {
        const take = Math.min(remaining, 75);
        filler.push(new Uint8Array(take).fill(0xab));
        remaining -= (take + 1); // +1 for the push opcode prefix
      }
      // Use OP_<cutSize> for the cut marker (only valid for 0..16).
      const cutOp = cutSize === 0 ? Op.OP_0 : (Op.OP_1 + cutSize - 1);
      return [Op.OP_NOP, cutOp, ...filler];
    }

    it('returns the input unchanged when no OP_NOP is present', () => {
      const script = [Op.OP_DUP, Op.OP_HASH160, Op.OP_EQUALVERIFY];
      const result = replaceBytecodeNop(script);
      // No OP_NOP, function returns original reference.
      expect(result).toEqual(script);
    });

    it('patches cut size with +1 when resulting bytecode <= 252 bytes', () => {
      // 50 filler bytes is well under 252.
      const script = makeScript(2, 50);
      const result = replaceBytecodeNop(script);
      // First element is now the patched cut size (was 2 → becomes 3).
      expect(result[0]).toEqual(Op.OP_3);
      expect(calculateBytesize(result)).toBeLessThanOrEqual(252);
    });

    it('patches cut size with +3 when resulting bytecode > 252 bytes', () => {
      // Push us past 252 bytes by adding enough filler.
      const script = makeScript(2, 260);
      const result = replaceBytecodeNop(script);
      // Was 2 → becomes 5 because the +3 branch fires.
      expect(result[0]).toEqual(Op.OP_5);
      expect(calculateBytesize(result)).toBeGreaterThan(252);
    });

    it('handles the boundary at exactly 252 bytecode bytes', () => {
      // Craft a script that lands at exactly 252 after the +1 patch.
      // This is the boundary case the audit flagged as needing coverage.
      const target = 252;
      // The +1 patch keeps the cut marker as a single byte. Pad to target.
      const baseSize = 2; // cut marker (1 byte) + minimum trailing structure
      const padBytes = target - baseSize;
      const script = makeScript(1, padBytes);
      const result = replaceBytecodeNop(script);
      // Must take the +1 branch (size <= 252), not +3.
      expect(result[0]).toEqual(Op.OP_2);
    });
  });

  describe.skip('TODO: generateRedeemScript()', () => {
  });

  describe.skip('TODO: optimiseBytecode()', () => {
  });
});
