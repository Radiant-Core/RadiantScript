/*   blake3.test.ts
 *
 * Coverage + regression test: the `blake3(...)` builtin must lower to its own
 * OP_BLAKE3 opcode and must stay DISTINCT from `sha256(...)` (OP_SHA256).
 * blake3 previously had no test coverage anywhere in the suite. See
 * ast/Globals.ts (GlobalFunction.BLAKE3) and generation/utils.ts
 * (GlobalFunction.BLAKE3 -> [OP_BLAKE3]).
 */

import { compileString } from '../../src/index.js';

// blake3 only — must emit OP_BLAKE3 and must NOT be aliased to OP_SHA256.
const blake3Only = `
pragma radiantscript ^1.1.0;
contract Blake3Only(bytes32 commitment) {
  return {
    reveal(bytes preimage) {
      require(blake3(preimage) == commitment);
    }
  };
}
`;

// blake3 + sha256 over the same preimage — proves the two builtins lower to
// distinct opcodes (both must appear in the output).
const blake3AndSha256 = `
pragma radiantscript ^1.1.0;
contract Blake3Mixed(bytes32 commitment) {
  return {
    reveal(bytes preimage) {
      require(blake3(preimage) == commitment);
      require(blake3(preimage) != sha256(preimage));
    }
  };
}
`;

describe('BLAKE3 hashing lowering', () => {
  it('lowers `blake3(...)` to OP_BLAKE3', () => {
    const asm: string = (compileString(blake3Only) as { asm: string }).asm;
    expect(asm).toContain('OP_BLAKE3');
  });

  it('does not alias blake3 to OP_SHA256', () => {
    const asm: string = (compileString(blake3Only) as { asm: string }).asm;
    expect(asm).not.toContain('OP_SHA256');
  });

  it('lowers blake3 and sha256 to distinct opcodes', () => {
    const asm: string = (compileString(blake3AndSha256) as { asm: string }).asm;
    expect(asm).toContain('OP_BLAKE3');
    expect(asm).toContain('OP_SHA256');
  });
});
