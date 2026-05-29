import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// USAGE:
//   $ npx ts-node update-version.ts 'X.Y.Z'
//   $ npx ts-node update-version.ts '1.2.3-rc.1'
//
// Validates the supplied version against semver before running lerna and
// rewriting the in-source `version` constant. We use execFileSync (not
// execSync) so the version string is passed as a positional argv entry
// rather than interpolated into a shell command — defence-in-depth in
// case the validation regex is ever loosened.

const version = process.argv[2];

if (!version) {
  console.error('Usage: update-version <semver>');
  process.exit(1);
}

// Subset of the official semver 2.0.0 grammar. Accepts:
//   MAJOR.MINOR.PATCH
//   MAJOR.MINOR.PATCH-PRERELEASE          (e.g. 1.0.0-rc.1, 1.0.0-v2)
//   MAJOR.MINOR.PATCH+BUILD               (e.g. 1.0.0+sha.abc)
//   MAJOR.MINOR.PATCH-PRERELEASE+BUILD
// Rejects anything containing shell metacharacters.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

if (!SEMVER_RE.test(version)) {
  console.error(`Invalid semver: ${JSON.stringify(version)}`);
  process.exit(1);
}

execFileSync(
  'npx',
  [
    'lerna',
    'version',
    '--no-push',
    '--no-git-tag-version',
    '--force-publish',
    '--yes',
    version,
  ],
  { stdio: 'inherit' },
);

const indexFilePath = path.join(__dirname, 'packages', 'cashc', 'src', 'index.ts');
const data = fs.readFileSync(indexFilePath, 'utf8');
const updatedData = data.replace(/export const version = .*\n/, `export const version = '${version}';\n`);
fs.writeFileSync(indexFilePath, updatedData);
