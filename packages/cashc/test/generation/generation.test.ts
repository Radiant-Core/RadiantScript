/*   generation.test.ts
 *
 * - This file is used to test the IR and target code generation
 */

import path from 'path';
import { compileFile } from '../../src/index.js';
import { fixtures } from './fixtures.js';

describe('Code generation & target code optimisation', () => {
  fixtures.forEach((fixture) => {
    it(`should compile ${fixture.fn} to correct Script and artifact`, () => {
      // These fixtures assert the exact artifact shape, so disable the heuristic
      // covenant lint here — its additive `warnings` field is exercised in
      // semantic/covenant_lint.test.ts, not in the codegen golden artifacts.
      const artifact = compileFile(
        path.join(__dirname, '..', 'valid-contract-files', fixture.fn),
        { covenantLint: 'off' },
      );
      expect(artifact).toEqual({ ...fixture.artifact });
    });
  });
});
