/*   bool_equality.test.ts
 *
 * Regression test for H-1: boolean `==` / `!=` must lower to the numeric
 * OP_NUMEQUAL / OP_NUMNOTEQUAL opcodes, NOT the bytewise OP_EQUAL / OP_EQUAL
 * OP_NOT. Otherwise non-canonical bool encodings (e.g. 0x01 vs 0x02, both
 * truthy) would not compare equal, bypassing equality gates.
 * See generation/GenerateTargetTraversal.ts visitBinaryOp().
 */

import { compileString } from '../../src/index.js';

const neContract = `
pragma radiantscript ^1.0.0;
contract BoolNe(bool admin) {
  return {
    spend(bool userFlag) {
      require(userFlag != admin);
    }
  };
}
`;

const eqContract = `
pragma radiantscript ^1.0.0;
contract BoolEq(bool admin) {
  return {
    spend(bool userFlag) {
      require(userFlag == admin);
    }
  };
}
`;

describe('Boolean equality lowering', () => {
  it('lowers bool `!=` to OP_NUMNOTEQUAL (not bytewise OP_EQUAL OP_NOT)', () => {
    const asm: string = (compileString(neContract) as { asm: string }).asm;
    expect(asm).toContain('OP_NUMNOTEQUAL');
    expect(asm).not.toContain('OP_EQUAL OP_NOT');
  });

  it('lowers bool `==` to OP_NUMEQUAL (not bytewise OP_EQUAL)', () => {
    const asm: string = (compileString(eqContract) as { asm: string }).asm;
    expect(asm).toContain('OP_NUMEQUAL');
  });
});
