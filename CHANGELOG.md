# Changelog

All notable changes to RadiantScript's published packages are documented here.

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Because
the monorepo uses Lerna's `independent` versioning mode, every release section is
grouped by package.

The cross-cutting context for this release — every line marked "audit §X" links
to the corresponding finding — lives in [`SECURITY_AUDIT_REPORT.md`](./SECURITY_AUDIT_REPORT.md).

---

## [Unreleased]

Nothing yet.

---

## 2026-05-28 — Audit-remediation release

End of the 2026-05-22 audit cycle and its 2026-05-28 re-audit. After this
release, every numbered finding in the audit (§1–§10) is FIXED, intentionally
labelled illustrative, or out of scope per the original §7.

### `radiantscript` 0.7.2 → **0.8.0**

Public SDK. Minor version bump because the public type surface widens; every
existing `number`-only call site continues to compile and behave identically.

#### Added
- **`SatoshiAmount = number | bigint`** — new exported type. `Recipient.amount`,
  `Output.amount`, and `Transaction.to(to, amount)` now accept either form so the
  full uint64 protocol satoshi range (up to `MAX_SAFE_SATOSHIS = 2^64 − 1`) is
  expressible. `validateAmount` enforces "safe integer" for numbers and
  "0 ≤ x ≤ uint64-max" for bigints. Internal amount-vs-amount arithmetic in
  `Transaction.setInputsAndOutputs` runs in bigint so large batches cannot
  silently wrap. (audit §3.7)
- **`SendOptions { signal?: AbortSignal; maxRetries?: number }`** — passable to
  `Transaction.send()`. The previous 1200×500 ms polling loop was uncancellable;
  consumers can now abort or shorten it. (audit §3.1)
- **Schema-validated `Contract` constructor** — `Contract.ts` runs `validateArtifact`
  on every artifact and throws with a descriptive field name on malformed input.
  Catches old-schema or third-party artifacts at construction rather than at
  signing time. (audit §3.8)

#### Fixed
- **`SignatureTemplate` WIF network check** had been silently disabled since
  it was added: it read `result.network` from libauth, but
  `decodePrivateKeyWif` returns `result.type` (`mainnet | testnet | *-uncompressed`).
  Now strips the `-uncompressed` suffix and compares correctly. (audit §3.6 follow-up)
- **`ElectrumNetworkProvider` mainnet fallback** referenced a non-existent
  `ElectrumTransport.SSL`; the second server registration would have thrown at
  runtime. Switched to `ElectrumTransport.TCP_TLS`. (audit §3.4 follow-up)
- **`Contract` populated `functions[undefined]`** for the constructor ABI entry
  (constructor entries have no `name`). Now filters to `type === 'function'` before
  iterating.
- **`splitStatefulBytecode` push-length bounds** — every push branch
  (`0x01`–`0x4b`, `OP_PUSHDATA1/2/4`) now verifies that the claimed payload fits
  inside the buffer. Previously a crafted push header could skip the cursor past
  a real `OP_STATESEPARATOR`, causing a stateful UTXO to be mis-classified as
  stateless. Four new regression tests cover the crafted-push cases.
  (audit §8.2/2)
- **`ElectrumNetworkProvider.ready()` now timeout-bounded** via
  `Promise.race(REQUEST_TIMEOUT_MS)`. Previously `ready()` could sit forever on
  a half-open socket. (audit §3.5)

#### Changed
- **Build target bumped es2015 → es2020** to enable BigInt literals (`0n`, `1n`)
  used by the SatoshiAmount widening. Node 14+ and all evergreen browsers
  support ES2020; CI tests Node 20.x / 22.x.
- **`@radiantscript/utils` dependency range** bumped to `^0.7.3` to pull the
  noble-backed hash module.

#### Removed
- **`examples/webapp/`** — was BCH-only (imported `bitbox-sdk`,
  `bitcoincashjs-lib`; hard-coded a cashaddr testnet address; linked to
  `explorer.bitcoin.com`). Photonic Wallet is the canonical Radiant frontend.
  (audit §8.2/6)
- **`packages/cashscript/test/e2e/old/`** + **`test/fixture/old/`** — used
  CashScript ^0.6.0 sources; the modern e2e suite covers the same contracts.
- **10 legacy `.cash` source files** under `test/fixture/` — used `pragma cashscript ^0.7.0`
  and did not compile; tests load the JSON artifacts (ported to current Radiant
  schema in this release).
- **`Contract › getBalance` from the unit suite** — both cases queried a live
  Radiant Electrum endpoint and depended on real funds. Moved to
  `test/e2e/Contract.balance.e2e.test.ts`.

### `@radiantscript/utils` 0.7.2 → **0.7.3**

Patch — internal changes only; public exports unchanged.

#### Added
- **`AbiFunction.covenant?: boolean`** — declared optional on the interface so
  `Transaction.ts` size-estimation code can read it without a type error. The
  Radiant compiler never sets this flag; runtime behaviour unchanged. (audit
  type-hygiene carry-over)

#### Changed
- **`hash.ts` migrated from `hash.js` to `@noble/hashes`** — `hash.js` has been
  unmaintained since 2020. `@noble/hashes ^1.8` is sync, pure-JS, audited, and
  actively maintained. The original audit recommended libauth, but libauth's
  hash implementations are WASM-backed and require an async
  `instantiateSha256()` step that would break the sync facade
  `decodePrivateKeyWif` and every other call site consume. All five existing
  hash-vector tests pass unchanged. (audit §4)
- **Target-code optimiser refactored to operate on opcode lists**, not ASM
  strings. The cashproof equivalence rules are parsed once at module load into
  structured `(lhs Op[], rhs Op[])` form; unknown opcode tokens and
  would-grow-the-script rules now throw at parse time rather than silently
  mis-firing via regex prefix collision. (audit §3.10)
- **`TypeError` accepts a single-arg "raw message" form** in addition to the
  existing `(actualType, expectedType)` shape so validation errors compile
  without losing precision. Backwards compatible.

### `rxdc` 1.1.0-v2 → **1.1.1-v2**

Patch — no compiler source changes. Bumped to keep the in-source `version`
constant aligned with `package.json` (enforced by the new CI version-sync
guard) and to pull the bumped `@radiantscript/utils`.

#### Fixed
- **24 cashc test-fixture pragmas** bumped from `^0.1.0` (rejecting the current
  1.x compiler) to `^1.0.0`. VersionError fixtures left alone so they continue
  to exercise the rejection path.
- **20 artifact-version strings** in `packages/cashc/test/generation/fixtures.ts`
  updated to `"rxdc 1.1.1-v2"`.
- **`split_size.cash` fixture** updated for the V2 hard fork — the compiler now
  emits `OP_2DIV` instead of `OP_DIV`-by-2.

### Repo-wide

#### Added
- **`SECURITY_AUDIT_REPORT.md`** — full audit transcript with status delta and
  remediation log. Every code change in this release links to a numbered
  finding.
- **CI `version-sync` job** in `.github/workflows/ci.yml` — asserts that
  `packages/cashc/src/index.ts`'s exported `version` constant matches
  `packages/cashc/package.json`. Catches the §2.1 mismatch class of bug at
  PR time rather than at release time.
- **FungibleToken example now actually enforces fungibility** — every output
  carrying `$tokenRef` must also have the FungibleToken code script
  (`tx.outputs.codeScriptCount(csh) == tx.outputs.refOutputCount($tokenRef)`).
  Closes the "split into a non-FungibleToken script" escape that satisfied
  `refValueSum` alone. (audit §2.6 / §8.2/1)
- **Property and boundary tests for the opcode-list optimiser** — 96 cashproof
  rules verified against a minimal opcode interpreter on 50 random starting
  stacks each, plus idempotence, monotonic non-growth, the stack-depth 3 and 4
  boundary cases, and explicit prefix-collision regressions. (audit §3.10)

#### Changed
- **`Dockerfile`** off EOL `node:10` + 2019-vintage `nginx:1.17.0`; now on
  `node:18-alpine` LTS + `nginx:stable-alpine`. The `worldtimeapi.org`
  cache-bust hack (a supply-chain risk) is replaced with a `CACHE_BUST` build
  arg. (audit §8.2/3)
- **`update-version.ts`** semver-validates its input and uses `execFileSync`
  (array args) instead of `execSync` template-interpolating into a shell.
  (audit §8.2/4)

#### Removed
- **`.travis.yml`** — `.github/workflows/ci.yml` is the canonical CI.
  (audit §8.2/5)

---

## Pre-2026-05-28

Pre-release history lives in the git log; this CHANGELOG starts at the
audit-remediation release because that's the first version with both a clean
correctness baseline and signed-off scope.
