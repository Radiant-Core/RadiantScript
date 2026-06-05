/*   int_literal_precision.test.ts
 *
 * Regression test for M-1: integer literals must be parsed with BigInt so that
 * values beyond 2^53 are preserved exactly (parseInt uses a lossy JS double).
 * A literal exceeding the signed 8-byte script-number bound must error.
 * See ast/AstBuilder.ts createIntLiteral().
 */

import { compileString } from '../../src/index.js';
import { IntLiteralOverflowError } from '../../src/Errors.js';

// 2^53 + 1: the smallest integer that a JS double cannot represent exactly.
const precisionContract = `
pragma radiantscript ^1.0.0;
contract BigLit(int x) {
  return {
    spend() {
      require(x == 9007199254740993);
    }
  };
}
`;

// 2^63 (= 9223372036854775808): one past the signed 8-byte script-number bound.
const overflowContract = `
pragma radiantscript ^1.0.0;
contract OverLit(int x) {
  return {
    spend() {
      require(x == 9223372036854775808);
    }
  };
}
`;

describe('Integer literal precision', () => {
  it('preserves 2^53+1 exactly (does not round to 2^53)', () => {
    const asm: string = (compileString(precisionContract) as { asm: string }).asm;
    // Correct little-endian script number encoding of 9007199254740993.
    expect(asm).toContain('01000000000020');
    // The rounded-to-2^53 (9007199254740992) encoding must NOT appear.
    expect(asm).not.toContain('00000000000020');
  });

  it('rejects a literal that exceeds the signed 8-byte script number bound', () => {
    expect(() => compileString(overflowContract)).toThrow(IntLiteralOverflowError);
  });
});
