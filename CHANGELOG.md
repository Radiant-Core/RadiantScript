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

### 2026-06-04 red-team remediation (see [`SECURITY_AUDIT_REPORT.md` §11](./SECURITY_AUDIT_REPORT.md))

A fresh adversarial pass found 16 issues beyond the §1–§10 "all closed" set — including a
**CRITICAL** compiler miscompile — all now fixed and regression-tested
(534 tests passing, lint clean, all `dist/` rebuilt).

#### `@radiantscript/rxdc` (compiler) — Fixed
- **[CRITICAL]** A function whose final statement was an `if` with **no `else`** compiled to an
  unconditional spend (the false branch fell through to an appended `OP_1`, skipping every
  `require`). A terminal branch now requires both an `else` and a closing `require` in each block. (§11.1/C-1)
- **[HIGH]** `bool ==` / `!=` emitted bytewise `OP_EQUAL`; now `OP_NUMEQUAL`/`OP_NUMNOTEQUAL`,
  so non-canonical bool encodings can't bypass equality gates. (§11.1/H-1)
- **[MEDIUM]** Integer literals were parsed with `parseInt` (lossy double); now parsed as `BigInt`
  with an 8-byte script-number range check (`IntLiteralOverflowError`). (§11.1/M-1)
- **[LOW]** Tuple-assignment no longer lets a split half be re-declared at a mismatched fixed
  `bytesN` bound; oversized `LockingBytecodeNullData` literal chunks (>255 bytes) now error. (§11.1/L-1, L-4)

#### `radiantscript` (SDK) — Fixed
- **[HIGH]** Full prevout verification before signing: `Transaction.build()` now fetches each
  input's source transaction, authenticates it (`hash256 == txid`), and asserts the prevout's
  value and locking script match what is being signed — so a malicious/buggy provider cannot make
  you sign over a wrong amount or a UTXO you don't control. Values are range-checked to Radiant's
  consensus `[0, MAX_MONEY]` (new `MAX_MONEY` constant). Default-on; opt out with
  `.withoutPrevoutVerification()` for offline signing. (§11.2/H-2, §11.5)
- **[HIGH]** `Transaction.getTxDetails` verifies returned tx hex hashes to the requested txid. (§11.2/H-3)
- **[HIGH]** Change-output fee now scales with `feePerByte` (was a flat 32 → underpaid on Radiant's
  relay floor). (§11.2/H-4)
- **[MEDIUM]** `withHardcodedFee(0)` is honored as a true zero fee; `BitcoinRpcNetworkProvider`
  rounds/validates satoshis; all providers run returned UTXOs through `validateUtxo`;
  `SIGHASH_SINGLE` signers with no corresponding output are rejected. (§11.2/M-2…M-5)
- **[LOW]** Mixed covenant hash types are rejected; `getBalance()` sums in bigint. (§11.2/L-2, L-3)

#### Examples — Changed
- `examples/radiant/*` hardened (StatefulCounter, NFT, TokenSwap, FungibleToken, MultiSigVault now
  compile and add the missing covenant constraints) and `README.md` relabelled as audited teaching
  templates rather than production-safe; false "no counterparty risk" / "automatic supply
  conservation" claims removed. (§11.3/M-6)

### 2026-06-09 covenant safety hardening (see [`SECURITY_AUDIT_REPORT.md` §12](./SECURITY_AUDIT_REPORT.md))

Two red-team rounds; all CRITICAL/HIGH/MEDIUM findings fixed and re-verified
(634 tests passing, lint clean, all `dist/` rebuilt).

#### `@radiantscript/rxdc` (compiler) — Added
- **Covenant lint pass** — a semantic traversal emitting heuristic warnings for covenant
  footguns: `missing-value-conservation`, `per-active-input-conservation` (the co-spend class),
  `unconstrained-outputs`, `aggregate-only`, `missing-continuity`, `continuity-count-trivial`,
  `auth-only-spend`, `dead-computed-value`. Default `warn` (CLI prints to stderr; JSON stays clean);
  `--strict` / `covenantLint:'off'|'warn'|'error'` escalate. Key-aware conservation-identity
  refinement + comment-directive suppression with unknown-rule diagnostics. (§12.1)

#### `radiantscript` (SDK) — Added/Changed
- **`withExactOutputs()`** — declare the exact output set; `build()` asserts the final set matches
  byte-exact, so the builder and on-chain covenant can't silently disagree. (§12.3)
- **`preflight()` / `send({preflight:true})`** — bounded structural pre-broadcast check (dust, fee,
  counts, conservation, template match, optional `testMempoolAccept`); explicitly NOT a VM. (§12.3)
- **Removed** the dead BCH preimage-covenant path; the `Contract` constructor now rejects any truthy
  `covenant` artifact; removed the stale L-2 mixed-hashtype guard. `toRegExp` `MAX_PATTERN_LENGTH`
  500→2000 (the 500 cap masked every `send()` failure reason). (§12.3)

#### Examples — Added
- **`examples/covenant-stdlib/`** — five gold-standard, fully-constrained, lint-clean reference
  covenants (SingletonNFT, FungibleToken, Vault, StatefulCounter, AtomicSwap) + an authoring guide.
  Red-team found and fixed CRITICAL (AtomicSwap multi-offer drain) / HIGH (Vault co-spend fee-burn) /
  MEDIUM (FungibleToken brick) bugs; invariant #0 added: never reason about `activeInputIndex` value
  without an `inputs.length` bound or a tx-wide aggregate. (§12.2, §12.4)

#### Verified
- **Regtest consensus proofs** (`tools/regtest/covenant-cospend/`) — both round-1 exploit
  mechanisms proven on the real Radiant v3.1.0 node: the co-spend attack is ACCEPTED on the
  buggy covenant and REJECTED by consensus on the fixed one, for both the value
  (`tx.inputs.length==1`) and ref (`tx.inputs.refOutputCount==1`) fixes. (§13.1)
- **RT-3 + FIX-E/FIX-F** — added linter rules `state-bound-to-noncarrier` and
  `forwarded-ref-uncontained` (HIGH false-negatives); `OutputTemplate.resolveOutput` now
  inserts `OP_STATESEPARATOR` to match `buildStatefulOutput`. (§13.2)

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

### `@radiantscript/rxdc` 1.1.0-v2 → **1.1.1-v2**

Patch + **renamed**. The package was previously published as the unscoped
`rxdc` name, but npm's typosquatting filter rejected new `rxdc` publishes
("too similar to existing packages rx, rfdc, rxjs, rc"). Moved into the
existing `@radiantscript` org scope alongside `@radiantscript/utils` so
the publish goes through and the package family stays under one scope.

The CLI binary is still installed as `rxdc` (the `bin` entry in
`package.json` defines the executable name independently of the package
name), so `npx rxdc`, `npm install -g @radiantscript/rxdc && rxdc ...`,
and the compiler's `compilerVersion: "rxdc 1.1.1-v2"` artifact field all
continue to work. Only the install command and the JavaScript-API import
specifier change:

```diff
- npm install rxdc
+ npm install @radiantscript/rxdc

- const { compileFile } = require('rxdc');
+ const { compileFile } = require('@radiantscript/rxdc');
```

No compiler source changes beyond the rename — bumped to keep the
in-source `version` constant aligned with `package.json` (enforced by the
new CI version-sync guard) and to pull the bumped `@radiantscript/utils`.

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
