export * from './Errors.js';
export * as utils from '@radiantscript/utils';
export { compileFile, compileString } from './compiler.js';

// Keep this in sync with packages/cashc/package.json.
// The repo's `update-version.ts` script rewrites this line on each release.
// We use a literal rather than `require('../package.json')` so the same source
// works for both the CommonJS and the ES module build (ESM has no `require`).
export const version = '1.2.0';
