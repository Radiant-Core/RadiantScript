/*   arithmetic.test.ts
 *
 * Regression test: the binary `*` and `/` operators on integers must lower to
 * the full binary OP_MUL / OP_DIV opcodes, NOT the unary OP_2MUL / OP_2DIV
 * (multiply / divide by 2). See generation/utils.ts compileBinaryOp().
 */

import { compileString } from '../../src/index.js';

const contract = `
pragma radiantscript ^1.1.0;
contract Arith() {
  return {
    f(int a, int b) {
      require(a * b == b * a);
      require(a / b >= 0);
      require(a % b >= 0);
    }
  };
}
`;

describe('Integer arithmetic lowering', () => {
  const artifact = compileString(contract);
  const asm: string = (artifact as { asm: string }).asm;

  it('lowers `*` to OP_MUL', () => {
    expect(asm).toContain('OP_MUL');
  });

  it('lowers `/` to OP_DIV', () => {
    expect(asm).toContain('OP_DIV');
  });

  it('lowers `%` to OP_MOD', () => {
    expect(asm).toContain('OP_MOD');
  });

  it('never emits the unary OP_2MUL / OP_2DIV for binary operators', () => {
    expect(asm).not.toContain('OP_2MUL');
    expect(asm).not.toContain('OP_2DIV');
  });
});
