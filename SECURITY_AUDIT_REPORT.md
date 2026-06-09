# RadiantScript — Full Repository Audit

**Repository:** `/Users/macbookair/CascadeProjects/RadiantScript`
**Audit date:** 2026-05-22
**Auditor:** Cascade (automated review)
**Scope:** Compiler (`packages/cashc`), SDK (`packages/cashscript`), utilities (`packages/utils`), example contracts (`examples/radiant/*.rxd`), build / CI / dependencies.

> RadiantScript is a fork of CashScript adapted to Radiant's extended opcode set (references, state separator, BLAKE3 / K12, SHA512_256, etc.). The codebase is structured as a Yarn/Lerna monorepo with three published npm packages: `rxdc` (compiler CLI), `radiantscript` (runtime SDK), `@radiantscript/utils`. Project self-describes as **alpha**.

---

## 1. Executive Summary

| Area | Status | Notes |
|------|--------|------|
| Compiler core (lex/parse/codegen) | **OK with caveats** | Solid CashScript heritage; Radiant opcode wiring looks correct. Version metadata is broken. |
| Transaction builder / SDK | **OK with caveats** | Reasonable safety bounds added; some unsigned-input handling weaknesses. |
| Network provider | **OK** | Retry, rate limit, circuit breaker added. Default mainnet endpoint is hard-coded. |
| Example contracts (`examples/radiant/`) | **HIGH-severity design flaws** | `TokenSwap`, `NFT.transferWithData`, `MultiSigVault.spendWithMinOutput`, `FungibleToken` semantics misleading. |
| Tests | **Partial** | ~160 unit tests; e2e tests require a live RXinDexer. No tests for `RadiantHelpers.ts` or the new constants/bounds checks. |
| Dependencies / supply chain | **Concerns** | Both `package-lock.json` and `yarn.lock` checked in; CI uses `npm ci`; `hash.js` used for sha512 with no test vectors; `electrum-cash` is the only mainnet endpoint client. |
| Docs / branding | **Inconsistent** | Mixed CashScript ↔ RadiantScript naming, pragma mismatches in legacy examples. |

**Showstoppers (must fix before mainnet):**
1. Version mismatch: `packages/cashc/src/index.ts` reports `0.1.0` while `package.json` is `1.1.0-v2`; all bundled `.rxd` examples (`pragma radiantscript ^0.9.0`) therefore **fail to compile**.
2. `examples/radiant/TokenSwap.rxd` does not enforce a real swap — token conservation per-reference is trivially satisfied without any value being exchanged.
3. Legacy `.cash` examples use `pragma cashscript ^0.7.0` which is rejected by the current grammar.

---

## 2. Critical / High-Severity Findings

### 2.1 [CRITICAL] Compiler version reported as `0.1.0`, breaks pragma checks
- `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashc/src/index.ts:5`
  ```
  export const version = '0.1.0';
  ```
- `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashc/package.json:3` declares `"version": "1.1.0-v2"`.
- `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashc/src/ast/AstBuilder.ts:122-130` uses the in-source `version` constant in `semver.satisfies(actualVersion, versionConstraint)`.
- Result: every shipped example (`pragma radiantscript ^0.9.0`) throws `VersionError: rxdc version 0.1.0 does not satisfy version constraint ^0.9.0`. `npx rxdc -V` also prints the wrong number.
- **Fix:** Generate `version` from `package.json` at build time (e.g. `import { version } from '../package.json' assert { type: 'json' }`) or have `update-version.ts` sync the two. Pick one canonical version and align all `pragma` lines in `examples/`.

### 2.2 [CRITICAL] Legacy `.cash` example pragmas no longer parse
The grammar token in `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashc/src/grammar/CashScript.g4:11-13` only accepts `'radiantscript'`, but the following still ship with `pragma cashscript ^0.7.0;` (would also need version bump anyway):
- `@/Users/macbookair/CascadeProjects/RadiantScript/examples/p2pkh.cash:1`
- `@/Users/macbookair/CascadeProjects/RadiantScript/examples/mecenas.cash:1`
- `@/Users/macbookair/CascadeProjects/RadiantScript/examples/mecenas_locktime.cash:1`
- `@/Users/macbookair/CascadeProjects/RadiantScript/examples/hodl_vault.cash:1`
- `@/Users/macbookair/CascadeProjects/RadiantScript/examples/announcement.cash:1`
- `@/Users/macbookair/CascadeProjects/RadiantScript/examples/transfer_with_timeout.cash:1`

**Fix:** rewrite pragmas to `pragma radiantscript <appropriate version>` or delete/move under a clearly labelled `legacy/` directory.

### 2.3 [HIGH] `TokenSwap.executeSwap` does not enforce the swap
`@/Users/macbookair/CascadeProjects/RadiantScript/examples/radiant/TokenSwap.rxd:25-48`
```
require(offerIn == offerOut);   // conservation of offer token
require(wantIn == wantOut);     // conservation of want token
require(offerIn >= offerAmount);
require(wantIn >= wantAmount);
```
- Conservation alone is **not** a swap. A malicious taker can sign a transaction that simply routes the offer token back to themselves and the want token back to themselves — `offerIn == offerOut` and `wantIn == wantOut` still hold.
- Nothing pins outputs to recipient public keys, nothing checks that the maker actually receives `wantAmount` to `makerPk`, and `takerPk` is user-supplied so the signature only proves the taker authorised the transaction shape — which they will, gladly, if it gives them everything for free.
- **Fix:** the contract must constrain at least one specific output's `lockingBytecode` and value (e.g. require an output paying `wantAmount` to `LockingBytecodeP2PKH(hash160(makerPk))`). Without this, ship the file as an inert *teaching* sample or remove it.

### 2.4 [HIGH] `NFT.transferWithData` accepts `newData` but ignores it
`@/Users/macbookair/CascadeProjects/RadiantScript/examples/radiant/NFT.rxd:35-45` — `newData` is never referenced in any `require`, never embedded in an output, and never compared against introspection. The function is identical to `transfer` from a script-verification point of view, but the comment "newData can be used in the output script's state section" suggests otherwise. This is a documentation-induced footgun.
- **Fix:** either drop the parameter or actually verify `tx.outputs[X].stateScript == ...newData...` using state-introspection ops.

### 2.5 [HIGH] `MultiSigVault.spendWithMinOutput` `minAmount` is taker-controlled and unbounded
`@/Users/macbookair/CascadeProjects/RadiantScript/examples/radiant/MultiSigVault.rxd:28-46`
- `minAmount` is a function argument, not a `constant` constructor parameter. Anyone with the two required signatures can call with `minAmount = 0`, making the check vacuous. The only effective check is the 546-sat dust floor.
- The block of three explicit `if (numOutputs >= n)` is fine but the comment ("Loop unrolling would be needed for variable iteration") implies a limitation rather than an intentional design.
- **Fix:** promote `minAmount` to a constructor parameter, or document loudly that this is illustrative only.

### 2.6 [HIGH] `FungibleToken` does not behave as a fungible token
`@/Users/macbookair/CascadeProjects/RadiantScript/examples/radiant/FungibleToken.rxd:22-50`
- Every spend requires `checkSig(s, ownerPk)`. That means recipients of a transfer cannot themselves transfer — only `ownerPk` can. This is essentially a *centralised* token where the owner has perpetual custody. As an example/template, this misleads developers about how fungible tokens should be structured on Radiant.
- `burn(int burnAmount)` does not constrain `burnAmount <= inputTokens`. The compiler enforces `inputTokens - burnAmount == outputTokens`, but with bignum semantics the resulting `outputTokens` can be negative, which the chain enforcement may handle, but the intent is unclear.
- **Fix:** redesign so the script enforces ownership transfer via P2PKH state on the output (the more idiomatic Radiant pattern), and bound `burnAmount` explicitly.

---

## 3. Medium-Severity Findings

### 3.1 SDK `Transaction.send()` — non-cancellable 10-min polling
`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/Transaction.ts:293-310` polls `getRawTransaction` 1200 times at 500 ms with no `AbortSignal`. A consumer that drops a reference to the promise has no way to cancel network traffic. Consider accepting an optional `AbortSignal` or `maxRetries` argument.

### 3.2 Default fee-per-byte clamp at 100 sat/byte
`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/Transaction.ts:150-159` rejects `feePerByte > 100`. Document this explicitly in the SDK README — it's a sane safety belt but will surprise anyone who genuinely needs more under congestion.

### 3.3 P2SH-only address derivation
`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/utils.ts:223-227` hard-codes `getP2SHVersionByte(Network.MAINNET)` inside `scriptToLockingBytecode`, even when called from a testnet/regtest context. Used only by `meep()`, but if it is later reused for non-`meep` callers the network mismatch becomes a real bug. Pass the network through.

### 3.4 `ElectrumNetworkProvider` mainnet has a single hard-coded server
`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/network/ElectrumNetworkProvider.ts:64-83`
- Mainnet uses one server: `electrumx.radiantcore.org:443`. There is no fallback. If that single host is down or compromised, every SDK consumer fails (or talks to a hostile node).
- Testnet has no default at all and throws.
- **Fix:** ship at least two priority servers, document a way to override, and seriously consider certificate pinning for the default (currently noted as not implemented in the file's own header comments).

### 3.5 Retry storm on `connectCluster` failure
`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/network/ElectrumNetworkProvider.ts:115-145`
- `connectCluster()` swallows errors and returns `[]`. The subsequent `await this.electrum.ready()` then sits forever (no timeout on `ready`). The 30 s per-request timeout only kicks in after `ready` resolves.
- **Fix:** wrap `ready()` with the same `REQUEST_TIMEOUT_MS` race.

### 3.6 Unused / non-validating `expectedNetwork` in `SignatureTemplate`
`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/SignatureTemplate.ts:49-65`
- `decodeWif` accepts an `expectedNetwork` parameter that is never passed by any caller. The check is dead code — and the constructor silently accepts WIFs from any network. For a mainnet SDK this is a footgun.
- **Fix:** require the network in the constructor (default mainnet), pass it through, throw on mismatch.

### 3.7 `bigIntToBinUint64LE(BigInt(amount))` can silently wrap large `number`
`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/Transaction.ts:201-205`
- `validateAmount` (`Transaction.ts:396-406`) is called *before* the `BigInt(amount)` conversion, which is good. However, `amount` is typed as `number` throughout `Output`/`Recipient` (`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/interfaces.ts`). Radiant satoshi values above `Number.MAX_SAFE_INTEGER` (2^53−1) cannot be represented losslessly. Maximum 64-bit satoshi space exceeds that. Either accept `bigint`/`string` for `amount`, or document the soft cap of 2^53 sats clearly.

### 3.8 `Contract.ts` does not validate `artifact.contract` is a string
`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/Contract.ts:39-47` checks for property presence with `'in' artifact` but accepts any truthy value. Malformed artifacts from third parties (a real concern when contracts are shared) would only fail later. A schema check (e.g. via `zod` or a hand-rolled `validateArtifact`) is worth the few lines.

### 3.9 `replaceBytecodeNop` algorithm subtle assumption
`@/Users/macbookair/CascadeProjects/RadiantScript/packages/utils/src/script.ts:228-272`
- The function finds the *first* `OP_NOP` and treats it as the cut marker. If a user contract intentionally uses `OP_NOP` for padding (unusual but legal), the result is silent miscompilation.
- The function also relies on `bytecodeSize > 252` to decide between `+1` and `+3` for the VarInt; the algorithm switches by re-encoding the script. The boundary case `bytesize == 252` deserves a unit test.

### 3.10 Optimisation pass uses untyped regex on ASM
`@/Users/macbookair/CascadeProjects/RadiantScript/packages/utils/src/script.ts:278-327` repeatedly does `scriptToAsm → regex → asmToScript`. Any opcode whose ASM token is a prefix of another (`OP_OR` vs `OP_ROT`, `OP_AND` vs ...) can be miscompiled if a future rule is added carelessly. Recommend (a) adding a fuzz/property test that compares pre- and post-optimisation evaluation behaviour against a Radiant interpreter, and (b) refactoring the optimiser to operate on `Script` (opcode list) rather than ASM strings.

### 3.11 Source map exposes original code in debug artifacts
`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashc/src/cashc-cli.ts:44-49` warns when `--debug` is used. Good. Make sure `--debug` is opt-in everywhere and never the default in `compileString`/`compileFile` (it currently isn't — verify before any UI integration).

### 3.12 Two lock files in the repo
- `package-lock.json` (574 KB) and `yarn.lock` (323 KB) co-exist.
- `.travis.yml` uses `npm test`. CI (`.github/workflows/ci.yml`) uses `npm ci`. The `package.json` scripts reference `yarn cashproof`.
- **Fix:** pick one package manager. With `lerna ^9` and `"workspaces"` field, either npm or yarn works; check in only one lockfile to avoid drift.
- **Status (2026-05-23):** `lerna.json` switched to `npmClient: "npm"` and `useWorkspaces` removed (deprecated in lerna v9). `yarn.lock` deleted in working tree; commit. Remaining doc updates of `yarn install` → `npm install` applied in `README.md`, `examples/README.md`, `docs/guides/quick-start.md`, `website/docs/basics/getting-started.md`.

### 3.13 Cashaddr leakage in tests / fixtures / docs (Radiant uses base58)
Radiant inherits Bitcoin's legacy base58check address scheme (no bech32 / no cashaddr / no `bitcoincash:` prefix). The SDK source code is *already* Radiant-correct — `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/utils.ts:214-256` uses `lockingBytecodeToBase58Address` / `base58AddressToLockingBytecode` with version bytes `0x05` (P2SH mainnet) / `0xc4` (P2SH testnet+regtest), and `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/Contract.ts:78` calls `scriptToAddress` which uses base58. `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/Transaction.ts:245` uses libauth's `addressContentsToLockingBytecode` which is just P2PKH script-template construction (network-agnostic), so no cashaddr exposure there.

**Remaining leakage (test / fixture / doc only):**
- `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/test/test-util.ts:2,22` — imports & calls `lockingBytecodeToCashAddress` for debug output. Swap to `lockingBytecodeToBase58Address` with the correct version byte (`getP2SHVersionByte(network)`).
- `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/test/util.test.ts:84-100` — assertions still expect `bitcoincash:` / `bchtest:` / `bchreg:` strings. These tests would already fail against the current source. Replace with base58 round-trip expectations.
- `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/test/fixture/vars.ts:23-24` — derives addresses via `bitbox.ECPair.toCashAddress`. `bitbox-sdk` is a stale BCH dep and is not installed by the current `package.json`; replace with libauth-based key + address derivation.
  - **Status (2026-05-23):** addressed. Fixture key material was rewritten onto libauth + Radiant base58 in a prior pass; in this pass the `oracle` / `oraclePk` exports also moved off the throwing `bitbox-sdk` stub onto a libauth-native price oracle (Schnorr over `sha256` of a 4-byte ‖ 4-byte script-num pair). The same construction is published as the runnable example `@/Users/macbookair/CascadeProjects/RadiantScript/examples/PriceOracle.ts`. The HodlVault e2e suite (`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/test/e2e/HodlVault.test.ts:14`) now `await`s `initFixtures()` so `oracle` + `vars.alicePk` / `vars.oraclePk` are populated before use. Still requires a live Radiant ElectrumX endpoint to actually exercise.
- ~~`@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/test/fixture/p2pkh-invalid.json:27` — contains a literal `bchtest:` address string.~~ **Resolved (2026-05-23):** re-encoded as Radiant base58 P2SH testnet address `2NGZzK76REJv8xuytvnQHwAQXURTBcD4b33` (version byte `0xc4`, scripthash `ffd7616dccb66109ac840cf9484e870ecac5e7fe`).
- `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/network/NetworkProvider.ts:11` — JSDoc reads "CashAddress for which we wish to retrieve UTXOs"; update to "Radiant base58 address".

**Bonus hardening uncovered while surveying:** `validateRecipient` at `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/src/utils.ts:43-47` validates `amount` but never that `recipient.to` is a parseable base58 address. A malformed `to` string only surfaces during locking-script construction. Add an early parseability check.

---

## 4. Low-Severity / Quality Findings

- **Misnamed compiler keyword tokens (`cashscript`/`CashScript`) in generated grammar files.** Not a runtime issue — the public token is `radiantscript`. But every error message that mentions "CashScript" is a leak of upstream identity. Examples:
  - `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashc/src/Errors.ts:28` — class `CashScriptError`.
  - Many generated `grammar/CashScript*` files. Acceptable, since they're build artefacts of `CashScript.g4`.
- **Unused `delay` import path:** SDK still depends on `delay@^5.0.0` purely for `await delay(500)` in `Transaction.ts`. Native `await new Promise(r => setTimeout(r, 500))` removes one dependency.
- **`hash.js`** is used for `sha256/sha512/ripemd160` in `@/Users/macbookair/CascadeProjects/RadiantScript/packages/utils/src/hash.ts`. `hash.js` is unmaintained (last release 2020). Libauth (already a dep) provides high-quality WASM SHA implementations. Migrating removes a stale crypto dep.
- **`Math.random()` used for retry jitter** in `ElectrumNetworkProvider.ts:212`. Acceptable for jitter; do not reuse this for anything security-relevant.
- **`Network` enum** is referenced as `Network.MAINNET` in `utils.ts` but compared as strings (`'mainnet'`, `'testnet'`, `'regtest'`) in `constants.ts#getDustLimit`. Use the enum everywhere.
- **`updateAfterRollup` style dead code:** `removeFinalVerify`'s comment block mentions logic about stack length `< 4` vs `>= 4` but `OP_NIP` for cleanup is always emitted via the per-iteration `cleanStack`. Worth a stress test where stack depth is exactly 3 and 4.
- **`README.md`** claims "Standard Library Templates" without warning that these are illustrative; given §2.3–§2.6, please add a clear disclaimer next to that table.
- **`docs/guides/`** referenced in README (`docs/guides/debugging-with-rxdeb.md`) — verify the link exists; the directory listing shows `docs/guides/` but I didn't enumerate it.
- **`OutputSatoshisTooSmallError`** is thrown for amounts `< DUST_LIMIT`, but `createOpReturnOutput` produces `amount: 0`, which is valid. The OP_RETURN path is correctly excluded because `validateRecipient` is called only from `to()`. Worth a unit test pinning this.
- **`scriptToAddress`** always produces a Base58 address; Radiant may support a CashAddr-style scheme in the future. Adding a `format` argument now keeps the API ergonomic later.
- **Test for `RadiantHelpers.ts` is absent.** Add unit tests for `encodeTokenRef`, `decodeTokenRef` round-trip, `buildStatefulOutput`, `splitStatefulBytecode` (especially edge cases around `OP_STATESEPARATOR` colliding with data pushes — the function comments acknowledge this is a "simple byte scan", which is incorrect for adversarial inputs).
- **`splitStatefulBytecode`** for `OP_PUSHDATA4` (`0x4e`) computes `pushLen` from four bytes but does not guard against malicious lengths exceeding the remaining buffer. Add bounds checks.

---

## 5. Positive Observations

- Defensive bounds and SDK-side validation were added across `Transaction.ts` (fee caps, input/output counts, transaction size, amount sanity). Good baseline.
- `ElectrumNetworkProvider` has rate limiting, circuit breaker, exponential backoff with jitter, and explicit timeouts — a real improvement over upstream CashScript.
- Compiler pipeline (Symbol Table → Type Check → EnsureFinalRequire → Codegen) is well-modularised and AST-driven; adding new Radiant opcodes is mostly localised to `ast/Globals.ts` + `generation/utils.ts`.
- Source map support and debug-mode warning are responsible defaults.
- CI matrix tests Node 20 and 22 with separate typecheck job.

---

## 6. Recommended Remediation Order

1. **Fix the version mismatch (§2.1)** — without this nothing compiles. Wire `package.json` version into `src/index.ts` via build step and update example pragmas to whatever the chosen canonical version is.
2. **Re-pragma or quarantine the legacy `.cash` examples (§2.2).**
3. **Rewrite or clearly mark the four flawed example contracts (§2.3 – §2.6).** These are the templates the project actively recommends in `README.md`; if developers copy-paste them they will deploy unsafe scripts.
4. **Add unit tests for `RadiantHelpers.ts` and `splitStatefulBytecode` edge cases.**
5. **Pick one package manager, drop the other lockfile.**
6. **Network provider hardening: testnet defaults + ready() timeout + ≥2 mainnet servers (§3.4, §3.5).**
7. **`SignatureTemplate` network-aware decoding (§3.6).**
8. **Refactor optimiser away from regex-on-ASM (§3.10), and add cashproof / property-based regression tests.**
9. **Audit `replaceBytecodeNop` boundary cases (§3.9).**
10. **Replace `hash.js` with libauth-native hashes.**

---

## 7. Out of Scope / Not Yet Reviewed

- ANTLR-generated grammar files (`packages/cashc/src/grammar/CashScript*.ts`) — regenerate from `.g4` rather than hand-editing.
- Property-based behavioural equivalence against a real Radiant node (`radiant-node`). The repo lists `cashproof` integration for the optimiser equivalences; a similar harness against Radiant introspection ops is desirable but not present.
- Webapp and `examples/webapp/` directory.
- Cross-package npm publish flow (`update-version.ts`, `lerna publish from-package`).

---

## 8. Re-audit Delta — 2026-05-28

Three remediation commits landed between 2026-05-23 and 2026-05-28 (`71a746a`, `7a23ef2`, `7aa1684`). This section records the verified status of every prior finding and lists new issues uncovered while verifying.

### 8.1 Status of prior findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| §2.1 | Compiler version `0.1.0` mismatch | **FIXED** | `packages/cashc/src/index.ts:9` exports `'1.1.0-v2'` matching `package.json`. `update-version.ts` still rewrites the constant. |
| §2.2 | Legacy `.cash` pragmas | **FIXED** | All six files relocated to `examples/legacy/`; root `examples/` no longer contains `.cash`. |
| §2.3 | `TokenSwap.executeSwap` doesn't enforce swap | **FIXED (with caveat)** | `examples/radiant/TokenSwap.rxd:14-19,67-76` now pins `outputs[0].lockingBytecode == LockingBytecodeP2PKH(hash160(makerPk))` and bounds the output value. Header comment documents Radiant introspection limits. |
| §2.4 | `NFT.transferWithData` ignores `newData` | **FIXED** | `examples/radiant/NFT.rxd:48` now requires `tx.outputs[0].stateScript == newData`. |
| §2.5 | `MultiSigVault` `minAmount` taker-controlled | **FIXED** | `examples/radiant/MultiSigVault.rxd:22` promotes `minAmount` to `int constant`. |
| §2.6 | `FungibleToken` not actually fungible | **PARTIAL** | Redesigned to per-holder pkh-in-state model (`examples/radiant/FungibleToken.rxd:26-44`). Burn now bounded (`>0` and `<= inputTokens`). **Residual issue — see §8.2/1.** |
| §3.1 | `Transaction.send()` polling not cancellable | **FIXED** | `Transaction.ts:55-60` adds `SendOptions { signal?: AbortSignal; maxRetries?: number }`. Abort checked at `Transaction.ts:334`. |
| §3.2 | Default 100 sat/byte fee clamp | **OK / DOCUMENTED** | JSDoc at `Transaction.ts:159-168` now explicit. |
| §3.3 | P2SH-only address derivation | **PARTIAL** | `utils.ts:246` parameter renamed `_network` (acknowledges it's unused). P2SH bytecode is genuinely network-agnostic, so no live bug, but dead param remains. |
| §3.4 | Single mainnet electrum, missing testnet | **FIXED** | `ElectrumNetworkProvider.ts:64-72` adds fallback `82.180.136.182:50012`. Testnet throws clear error directing users to override. |
| §3.5 | `ready()` no timeout | **FIXED** | `ElectrumNetworkProvider.ts:151-154` races `ready()` against `REQUEST_TIMEOUT_MS`. |
| §3.6 | `SignatureTemplate` ignores network | **FIXED** | Constructor now accepts `network` and `decodeWif` throws on mismatch (`SignatureTemplate.ts:8-21,50-65`). |
| §3.7 | `amount: number` lossy above 2^53 sats | **PARTIAL** | Type still `number` in `interfaces.ts`. Runtime guard added: `validateAmount` clamps to `MAX_SAFE_SATOSHIS` before `BigInt()` conversion (`Transaction.ts:437-447`). No overflow path, but API still lossy. |
| §3.8 | Artifact validation weak | **FIXED** | `Contract.ts:155-195` adds `validateArtifact()` with explicit `typeof` guards on `contract`/`asm`/ABI entries; called at `Contract.ts:40`. |
| §3.9 | `replaceBytecodeNop` first-NOP / VarInt boundary | **PARTIAL** | Bounds-checks added (`script.ts:237-262`). Boundary `bytecodeSize == 252` now takes the `+1` path correctly (`script.ts:266` uses `> 252`). Still uses first-OP_NOP heuristic without collision detection. |
| §3.10 | Optimiser regex-on-ASM | **OPEN** | `script.ts:303-327` still constructs `new RegExp` from external `.equiv` patterns. No prefix-collision tests added. |
| §3.11 | Source map debug exposure | **OK** | `--debug` still opt-in in `cashc-cli.ts`. |
| §3.12 | Two lock files / mixed pkg manager | **FIXED** | `yarn.lock` deleted, `lerna.json` set to `npmClient: "npm"`. Docs updated. **Exception:** `Dockerfile:11,18` still uses `yarn` — see §8.2/3. |
| §3.13 | Cashaddr leakage | **MOSTLY FIXED** | Tests, fixtures, and key derivation migrated to libauth + base58. **Open residue:** `NetworkProvider.ts:11` JSDoc still reads "CashAddress". |

### 8.2 New findings (current code)

1. **[MED] `FungibleToken.transfer()` only constrains `outputs[0]`, but `refValueSum` aggregates across all outputs** — `examples/radiant/FungibleToken.rxd:38-44` enforces `tx.inputs.refValueSum == tx.outputs.refValueSum` and pins `outputs[0].codeScript`, but says nothing about outputs 1..n. A holder can route part of the token reference into a non-FungibleToken codeScript on `outputs[1]`, which still satisfies refValueSum conservation but escapes the contract's transfer rules. The redesign is much better than the v1 owner-locked model, but the example still teaches an incomplete pattern.
   - **Fix:** require `forEach` over outputs carrying `$tokenRef` to share the same codeScript, or document the constraint that all carrier outputs must use the same contract. Until then, label this an illustrative example.

2. **[MED] `splitStatefulBytecode` push-length checks let crafted pushes hide a real `OP_STATESEPARATOR`** — `packages/cashscript/src/RadiantHelpers.ts:158-178`. For each push opcode (0x01–0x4b, 0x4c, 0x4d, 0x4e) the function increments `i` by `1 + pushLen` (or similar) without verifying that `i + 1 + pushLen <= lockingBytecode.length`. The OP_PUSHDATA4 branch (line 174) compares `pushLen > lockingBytecode.length` — loose: a `pushLen` of e.g. `0xFFFF_FFF0` skips past every subsequent byte, and the while loop simply exits returning `null`. There is no OOB crash (JS reads beyond `length` return undefined), but an attacker who controls a locking bytecode can construct a push whose claimed length carries the cursor past a *real* state separator, so `splitStatefulBytecode` returns `null` and the caller mis-classifies the UTXO as stateless. Fix: bound each `i +=` advance against `lockingBytecode.length` and treat over-advance as malformed.

3. **[MED] `Dockerfile` is on EOL Node 10 + Nginx 1.17.0 (2019) + still uses `yarn`** — `Dockerfile:2,11,18,23` contradicts the §3.12 npm-only standardization, and the base images haven't received security updates in years. Only affects the website (Docusaurus); SDK consumers unaffected. Also `ADD "http://worldtimeapi.org/api/timezone/Europe/Amsterdam.txt" skipCache` (lines 7, 26) injects an external dependency into builds — if that host is compromised, builds embed attacker-controlled bytes (low risk: only used as cache-bust). Fix: bump base images, switch to `npm ci`, drop the worldtimeapi cache-bust.

4. **[LOW] `update-version.ts` shell-injects `process.argv[2]`** — `update-version.ts:9` interpolates the unvalidated version arg directly into a shell command via `execSync`. A developer typo like `update-version '1.0.0; rm -rf ~'` would execute. Not internet-reachable; developer release script only. Fix: validate against semver regex before interpolation, or pass args as an array via `execFileSync`.

5. **[LOW] `.travis.yml` still present and contradicts active CI** — Root `.travis.yml` runs `npm test` but `.github/workflows/ci.yml` is the actual CI. Dead config files cause confusion; recommend deletion.

6. **[LOW] `examples/webapp/src/App.tsx` hard-codes the literal string `'CashScript'` as a seed/example** — Misleading branding for example code in the published repo; trivial to fix during the broader rebrand sweep.

7. **[LOW] No test asserts `update-version.ts` keeps `packages/cashc/src/index.ts` in sync** — Human error at release time can re-introduce §2.1. Either generate the constant at build time from `package.json` (preferred), or add a CI assertion that the two values match.

8. **[LOW] `NetworkProvider.ts:11` JSDoc still mentions "CashAddress"** — Last cashaddr leak; cosmetic but worth scrubbing.

### 8.3 New showstoppers

None. The original §2.1–§2.5 showstoppers are all fixed. §2.6 (`FungibleToken`) is functionally much better but still teaches a slightly incomplete pattern; the residual issue is a template-quality concern, not a deployment blocker, *provided the README disclaimer (added in `7a23ef2`) is preserved.*

### 8.4 Recommended next remediation order

1. Tighten `splitStatefulBytecode` push-length bounds (§8.2/2).
2. Constrain all carrier outputs in `FungibleToken.transfer()` (§8.2/1) — or relabel as illustrative.
3. Refresh `Dockerfile` (§8.2/3).
4. Sweep the remaining cashaddr JSDoc (§3.13 residue) and the `_network` dead parameter (§3.3).
5. Type `amount` as `number | bigint` in `interfaces.ts` (§3.7) — runtime guard is in place but the public type still constrains callers to lossy `number`.
6. Replace the regex-on-ASM optimiser with an opcode-list pass (§3.10).
7. Replace `hash.js` with libauth-native hashes (§4 carry-over).

---

*End of 2026-05-28 re-audit delta.*

---

## 9. 2026-05-28 Remediation Log

Code changes made the same day to close out the §8 follow-up list. Test counts at start of session: 270 passing + 56 failing across cashc (pragma drift) + 53 passing + 9 schema failures across cashscript Contract.test + ~200 typecheck errors blocking the cashscript build. End of session: **326 root tests + 61 cashscript unit tests = 387 passing, 1 failing**, and the cashscript package typechecks cleanly. Highlights:

### 9.1 Security correctness
- **§8.2/2 FIXED — `splitStatefulBytecode` push-length bounds** ([RadiantHelpers.ts:158-186](packages/cashscript/src/RadiantHelpers.ts:158)). Every push branch (direct, OP_PUSHDATA1/2/4) now verifies `i + header + payload <= bytecode.length` before advancing. Four new regression tests in [RadiantHelpers.test.ts](packages/cashscript/test/RadiantHelpers.test.ts) cover the crafted-push case where the old code would silently skip past a real `OP_STATESEPARATOR`.
- **§3.6 follow-up FIXED — `SignatureTemplate.decodeWif` was reading the wrong field** ([SignatureTemplate.ts:50-71](packages/cashscript/src/SignatureTemplate.ts:50)). The §3.6 fix asserted `result.network`, but libauth's `decodePrivateKeyWif` returns `result.type` (`'mainnet' | 'testnet' | 'mainnet-uncompressed' | 'testnet-uncompressed'`). The check was a no-op until now. Comparison now strips the `-uncompressed` suffix and matches against the expected network. Without this, the §3.6 network guard had been silently disabled since it was added.
- **§3.4 follow-up FIXED — `ElectrumNetworkProvider` referenced a non-existent `ElectrumTransport.SSL`** ([ElectrumNetworkProvider.ts:72](packages/cashscript/src/network/ElectrumNetworkProvider.ts:72)). electrum-cash exposes `TCP_TLS` (scheme `'tcp_tls'`), not `SSL`. The fallback server entry would have thrown at runtime. Now correctly references `TCP_TLS`.
- **`Contract` was indexing `this.functions[undefined]` for the constructor entry** ([Contract.ts:68-78](packages/cashscript/src/Contract.ts:68)). The ABI mixes function entries (with `name`) and a constructor entry (without). The previous `forEach` silently set `functions[undefined] = ...`. Now filters to `type === 'function'` before iterating.

### 9.2 Build / tooling / CI hardening
- **§8.2/4 FIXED — `update-version.ts` shell injection** ([update-version.ts](update-version.ts)). Validates input against semver regex and uses `execFileSync` (array args) instead of `execSync` template-interpolating into a shell.
- **§8.2/3 FIXED — `Dockerfile` modernised** ([Dockerfile](Dockerfile)). `node:10` → `node:18-alpine`, `nginx:1.17.0-alpine` → `nginx:stable-alpine`, dropped the `worldtimeapi.org` cache-bust (replaced with a `CACHE_BUST` build arg), added `--frozen-lockfile` for reproducibility.
- **§8.2/5 FIXED — Deleted stale `.travis.yml`**. `.github/workflows/ci.yml` is the canonical CI.
- **§2.1 hardened — CI guard prevents version drift** ([ci.yml `version-sync` job](.github/workflows/ci.yml)). Asserts `packages/cashc/src/index.ts`'s `version` constant matches `packages/cashc/package.json`. Fails the build with a clear message if they diverge, so a future release that forgets to run `update-version.ts` cannot regress §2.1.
- **`bip68` type shim** ([packages/cashscript/src/types/bip68.d.ts](packages/cashscript/src/types/bip68.d.ts)) covers the two helpers RadiantScript actually uses.

### 9.3 Test-suite cleanup
- **24 cashc fixture pragmas bumped** from `^0.1.0` (rejecting the current 1.x compiler) to `^1.0.0` across `valid-contract-files/` and the non-VersionError sub-directories. VersionError fixtures left alone so they continue to test rejection paths.
- **20 artifact-version strings bumped** from `"rxdc 0.1.0"` → `"rxdc 1.1.0-v2"` in [`packages/cashc/test/generation/fixtures.ts`](packages/cashc/test/generation/fixtures.ts).
- **`split_size.cash` fixture updated for V2 fork** to expect `OP_2DIV` instead of `OP_DIV` (the compiler now emits the optimised opcode added in commit `ac69ad2`).
- **10 cashscript JSON fixtures ported from CashScript v0.7 schema to current Radiant schema**: `contractName → contract`, `bytecode → asm`, `abi[].inputs → abi[].params`, hoisted `constructorInputs` into an `abi[]` `type: 'constructor'` entry. Test file references updated to match. Ported via a one-off script (not retained — fixtures are static).
- **Errors.ts `TypeError` constructor now accepts a single-arg "raw message" form** so validation errors added in earlier passes (hex-length cap, byte-array size cap, etc.) compile cleanly. Backwards compatible with the two-arg `(actualType, expectedType)` form.
- **`AbiFunction.covenant` declared optional** in [`packages/utils/src/artifact.ts`](packages/utils/src/artifact.ts). The legacy BCH covenant flag is never set by the Radiant compiler, but `Transaction.ts` size-estimation code reads it; this makes the read type-safe without changing runtime behaviour.
- **`Uint8Array` variance**: Transaction.ts cast `unlockingBytecode` from `Uint8Array<ArrayBufferLike>` to `Uint8Array<ArrayBuffer>` with a comment explaining the libauth 1.19 narrowing — owned-buffer guarantee holds in practice.

### 9.4 What's still open
- **§2.6/§8.2/1 (FungibleToken `transfer()` only pins `outputs[0]`)** — flagged in §8.2 and *not yet fixed*. Needs either a `forEach` over all outputs carrying `$tokenRef` (constrain them to share the same `codeScript`) or an explicit "illustrative only" label. Doesn't block any test.
- **§3.7 (amount type still `number`)** — runtime guard is in place via `MAX_SAFE_SATOSHIS`. Lifting the public API to accept `number | bigint` is a non-trivial refactor across `Output`, `Recipient`, `to()`, and `Transaction.send`.
- **§3.10 (regex-on-ASM optimiser)** — still ASM-string-based in [`packages/utils/src/script.ts`](packages/utils/src/script.ts). Refactoring to an opcode-list pass is its own project.
- **`hash.js` migration** — still used in [`packages/utils/src/hash.ts`](packages/utils/src/hash.ts).
- **One Contract.test.ts case fails offline** — `Contract › getBalance › should return balance for existing contract` queries a live Radiant Electrum endpoint for funds at a known address. Effectively an e2e test; not introduced by this session.
- **8 pre-existing test files use the old grammar** for fixture sources (`transfer_with_timeout.cash`, etc. under `packages/cashscript/test/fixture/`) but the JSON artifacts have been ported. The `.cash` sources are stale documentation only — tests load the JSON, not the `.cash`.

---

*End of 2026-05-28 remediation log.*

---

## 10. 2026-05-28 Final Remediation Pass

Continued the same day with the §9.4 follow-up list. End state: **326 root + 68 cashscript unit = 394 tests passing, 0 failing**; both live-network checks live under `test/e2e/`.

### 10.1 Closed in this pass

- **§8.2/6 → §2.6 carry-over: FungibleToken example** ([examples/radiant/FungibleToken.rxd](examples/radiant/FungibleToken.rxd)). Rewritten in the current grammar (functions inside `return { ... }`) — the previous shape did not even compile under 1.x. `transfer()` and `burn()` now constrain every output carrying `$tokenRef` to share the FungibleToken code script via `tx.outputs.codeScriptCount(csh) == tx.outputs.refOutputCount($tokenRef)`, closing the "split into a non-FungibleToken script" escape that satisfied refValueSum alone. Value conservation switched to `codeScriptValueSum` to match the constrained output set.
- **§8.2/6 webapp + branding** ([`examples/webapp/`](examples/webapp/)). Deleted. The webapp imported BCH-only SDKs (`bitbox-sdk`, `bitcoincashjs-lib`), hard-coded a cashaddr testnet address, linked to `explorer.bitcoin.com`, and used `cashscript ^0.7.0-next.0`. Not referenced from anywhere; Photonic Wallet is the canonical Radiant frontend.
- **Live-network test moved to e2e** ([`packages/cashscript/test/e2e/Contract.balance.e2e.test.ts`](packages/cashscript/test/e2e/Contract.balance.e2e.test.ts)). Both `Contract › getBalance` cases hit a live Radiant Electrum endpoint and depended on real funds; they no longer block the offline unit suite.
- **Legacy `test/e2e/old/` + `test/fixture/old/`**. Deleted. Used CashScript ^0.6.0 sources; the modern `e2e/Mecenas.test.ts` / `e2e/misc.test.ts` already cover the same contracts.
- **§4 hash.js carry-over** ([`packages/utils/src/hash.ts`](packages/utils/src/hash.ts)). Migrated to `@noble/hashes` ^1.8 (sync, pure-JS, audited, actively maintained). The audit's preferred path was libauth, but libauth's hash is WASM-backed and requires async `instantiateSha256()`, which would break the sync facade that `decodePrivateKeyWif` and every other caller consume. The choice is documented in the new module header. All five existing hash-vector tests pass unchanged.
- **§3.7 amount type widening** ([`packages/cashscript/src/interfaces.ts`](packages/cashscript/src/interfaces.ts), [`Transaction.ts`](packages/cashscript/src/Transaction.ts), [`utils.ts`](packages/cashscript/src/utils.ts)). New `SatoshiAmount = number | bigint`. `Recipient.amount`, `Output.amount`, and `Transaction.to(to, amount)` accept either. `validateAmount` enforces: number must be a safe integer, bigint must be ≥ 0n and ≤ `MAX_SAFE_SATOSHIS` (uint64 max). Internal amount-vs-amount arithmetic in `setInputsAndOutputs` runs entirely in bigint so large batches cannot silently wrap. Build target bumped es2015 → es2020 for BigInt literals. Eight new tests in `Transaction.test.ts` cover both branches of the type widening end-to-end.

### 10.2 Still open

- ~~**§3.10 ASM-regex optimiser** ([`packages/utils/src/script.ts:303-327`](packages/utils/src/script.ts:303)). The optimiser still builds `new RegExp` from external `cashproof-optimisations.equiv` patterns and runs on ASM strings. Refactoring this to an opcode-list pass with property-based regression tests is its own project; deferred.~~ **FIXED (2026-05-28, follow-up pass).** [`packages/utils/src/script.ts`](packages/utils/src/script.ts) now parses `cashproof-optimisations.ts` *once at module load* into structured `(lhs Op[], rhs Op[])` rules; unknown opcode tokens and would-grow-the-script rules throw at parse time. The seven hardcoded post-cashproof rules (NOT IF, CHECKMULTISIG VERIFY, the SWAP-with-AND/OR/XOR triplet, DUP-with-AND/OR) are lifted into the same structured form, plus two derived rules (`OP_SWAP OP_EQUALVERIFY` and `OP_SWAP OP_NUMEQUALVERIFY` collapse) that the regex pipeline had been applying *implicitly* via prefix collision — exactly the failure mode the audit flagged. Matching is performed directly on the opcode list (`Op[]`), with leftmost non-overlapping replacement to a fixed point. Data pushes are never eligible for opcode match. An entry-time canonicalisation maps the codegen's `encodeInt(0)` (empty-`Uint8Array`) to numeric `Op.OP_0` so the existing `OP_0`-prefixed rules still fire; no other small-int needs this because their `encodeInt` output is *not* bytewise equivalent to `OP_N`. New tests in [`packages/utils/test/script-optimise.test.ts`](packages/utils/test/script-optimise.test.ts) cover all 96 rules with a minimal opcode interpreter on 50 random starting stacks each (per-rule equivalence), end-to-end invariants (idempotence, monotonic non-growth), the stack-depth 3 and 4 boundary cases around the codegen's `removeFinalVerify` + `cleanStack` chain (audit §4 carry-over), and explicit prefix-collision spot checks. All 20 pinned cashc generation fixtures and a baseline `FungibleToken.rxd` byte-comparison verified byte-identical pre/post-refactor. **End state: 436 root + 68 cashscript unit = 504 tests passing, 0 failing.**

Everything else from §1–§9 is now either FIXED, intentionally documented as illustrative, or out of scope per the original audit's §7.

---

*End of 2026-05-28 final remediation pass.*

---

## 11. 2026-06-04 Red-Team Pass

A fresh adversarial pass was run *because* §1–§10 declared everything closed — the goal was to find the bugs a "done" audit misses. It did. The headline is a **live CRITICAL compiler bug that silently produces always-spendable contracts** (§11.1/C-1) — the exact failure class as the OP_2MUL/OP_2DIV miscompile, and proof that "all findings FIXED" was premature. Sixteen findings were confirmed (3 of them proven by compiling exploit contracts through the built `rxdc 1.1.1-v2`) and **all sixteen are now fixed and regression-tested**.

**End state: 449 root (cashc + utils) + 96 cashscript unit = 545 tests passing, 0 failing; `npm run lint` clean; all three package `dist/` rebuilt; all five `examples/radiant/*.rxd` compile.** Baselines at start of pass were 440 root + 68 cashscript. (H-2 was subsequently upgraded from a range-check to full prevout verification — §11.5 — adding the final 11 cashscript tests.)

### 11.1 Compiler (`cashc` / `utils`)

- **[CRITICAL] C-1 — terminal `if` with no `else` compiled to an unconditional spend.** [`EnsureFinalRequireTraversal.ts:50`](packages/cashc/src/semantic/EnsureFinalRequireTraversal.ts:50). A final `BranchNode` was checked via `finalStatement.elseBlock?.statements`; with no else that is `undefined` → defaults to `[]` → `statements[-1]` is `undefined` → the pass returned silently without requiring the else path. `removeFinalVerify` then appended `OP_1` after `OP_ENDIF`, so a spend taking the false branch succeeded with **no signature/condition check**. *Proven:* `if (mode == 1) { require(checkSig(s, owner)); }` (no else) compiled to `… OP_IF … OP_CHECKSIGVERIFY OP_ENDIF OP_DROP OP_1` — spendable by anyone with `mode != 1`. **Fix:** a terminal branch must now have an `else`, and both blocks must themselves terminate in a `require` (else → `FinalRequireStatementError`). Negative fixture `final_branch_no_else.cash` + valid `final_branch_else.rxd` added. (The shipped `announcement.cash` example actually exhibited the bug — fixed with an explicit `else`.)
- **[HIGH] H-1 — `bool ==` / `!=` emitted bytewise `OP_EQUAL` instead of `OP_NUMEQUAL`.** [`GenerateTargetTraversal.ts` `visitBinaryOp`](packages/cashc/src/generation/GenerateTargetTraversal.ts:463) + [`types.ts:153`](packages/utils/src/types.ts:153). `resultingType(BOOL,BOOL)` is `BOOL`, so `isNumeric` was false and bool equality compiled bytewise — two logically-true bools with different encodings (`0x01` vs `0x02`) compared unequal, letting an attacker-supplied bool param bypass an equality gate. **Fix:** treat `BOOL` as numeric for `==`/`!=` (→ `OP_NUMEQUAL`/`OP_NUMNOTEQUAL`); confirmed `TypeCheck` forbids arithmetic on bool so no other operator is affected. Generation test added.
- **[MEDIUM] M-1 — integer literals parsed with `parseInt` (lossy double).** [`AstBuilder.ts` `createIntLiteral`](packages/cashc/src/ast/AstBuilder.ts). `9007199254740993` (2⁵³+1) silently became 2⁵³; oversized literals exceeded the 8-byte script-number bound with no diagnostic. **Fix:** parse value + unit multiplier as `BigInt`, range-check `±(2⁶³−1)`, throw new `IntLiteralOverflowError` on overflow; `IntLiteralNode.value` widened to `bigint`. *Proven:* 2⁵³+1 now encodes exactly `01000000000020`; 2⁶³ errors.
- **[LOW] L-1 — tuple-assign bytes-bound escape.** [`TypeCheckTraversal.ts` `visitTupleAssignment`](packages/cashc/src/semantic/TypeCheckTraversal.ts:66). `bytes16 a, bytes32 b = data.split(16)` was accepted with no width enforcement. **Fix:** when the source is bounded bytes and the split index is a constant, the exact half-widths are computed and a disagreeing declared bound is rejected (`AssignTypeError`); unbounded sources / non-constant indices stay permissive so existing split contracts still compile.
- **[LOW] L-4 — `LockingBytecodeNullData` size prefix only handled ≤255 bytes.** [`GenerateTargetTraversal.ts` NULLDATA](packages/cashc/src/generation/GenerateTargetTraversal.ts:401). **Fix:** literal chunks >255 bytes now throw `NullDataSizeError` at compile time; the dynamic-size branch's ≤255 limitation is documented in-code.

### 11.2 SDK (`cashscript`)

- **[HIGH] H-2 — input satoshis from the network provider were signed into the sighash unvalidated.** [`Transaction.ts`](packages/cashscript/src/Transaction.ts) → [`utils.ts`](packages/cashscript/src/utils.ts). A lying server could make the SDK commit to a wrong input amount (invalid-sig griefing, or skewed covenant payout math in RadiantMM/RadiantSwap). **Fix:** every input's `satoshis` runs through `validateAmount`, **and** `build()` now performs full prevout verification before signing — see §11.5.
- **[HIGH] H-3 — `getTxDetails` trusted server tx hex without checking it hashes to the requested txid.** [`Transaction.ts` `getTxDetails`](packages/cashscript/src/Transaction.ts). Enabled "confirmed but isn't" forged state. **Fix:** `binToHex(hash256(bytes).reverse())` is compared to the requested `txid`; mismatch throws (and now propagates instead of being swallowed by the retry loop).
- **[HIGH] H-4 — change-output fee ignored `feePerByte`.** [`Transaction.ts`](packages/cashscript/src/Transaction.ts). The change output's cost was a flat `P2SH_OUTPUT_SIZE` (32) with no rate factor → systematic underpayment given Radiant's high relay floor. **Fix:** `change -= ceil(P2SH_OUTPUT_SIZE * feePerByte)`. Test asserts the change cost scales with the rate (mutation-verified).
- **[MEDIUM] M-2 — `withHardcodedFee(0)` was silently overridden.** [`Transaction.ts`](packages/cashscript/src/Transaction.ts). Line 401 honored `0` via `??`, but three sibling branches gated on `!this.hardcodedFee`. **Fix:** single `useHardcodedFee = hardcodedFee !== undefined` used everywhere; `0` now yields a true zero fee.
- **[MEDIUM] M-3 — `BitcoinRpcNetworkProvider` float-multiplied coin amounts.** [`BitcoinRpcNetworkProvider.ts`](packages/cashscript/src/network/BitcoinRpcNetworkProvider.ts). `amount * 1e8` produced non-integers that threw in `BigInt()` for honest nodes. **Fix:** `Math.round` + finite/non-negative guard, then routed through the new `validateUtxo`.
- **[MEDIUM] M-4 — providers didn't validate returned UTXOs.** All four providers. **Fix:** shared `validateUtxo()` in [`utils.ts`](packages/cashscript/src/utils.ts) (txid `^[0-9a-f]{64}$`, integer `vout ≥ 0`, integer `satoshis ∈ [0, MAX_SAFE_SATOSHIS]`); `BitboxNetworkProvider` previously returned UTXOs unmapped — now mapped + validated.
- **[MEDIUM] M-5 — `SIGHASH_SINGLE` input with index ≥ output count signed the zeroed output hash.** [`Transaction.ts`](packages/cashscript/src/Transaction.ts). **Fix:** `assertSingleHasOutput` throws when a `SIGHASH_SINGLE` signer has no corresponding output, on both signing paths.
- **[LOW] L-2 — mixed covenant hash types.** [`Transaction.ts`](packages/cashscript/src/Transaction.ts). The on-stack preimage used only the first signer's hash type. **Fix:** differing hash types among covenant signature args now throw.
- **[LOW] L-3 — `getBalance()` summed in `number`.** [`Contract.ts`](packages/cashscript/src/Contract.ts). **Fix:** sums in `bigint`; throws past `Number.MAX_SAFE_INTEGER` rather than silently rounding (public `number` return kept).

### 11.3 Example library (`examples/radiant/`)

- **[MEDIUM] M-6 — templates were marketed as a "Standard Library" but were under-constrained** (and four of five did not even compile under the 1.x grammar). **Fix (both hardened *and* relabelled):**
  - *StatefulCounter* — now authenticates `currentCount` against the input's own state, pins a single same-code continuation, conserves value, and binds the next state to `newCount` (limitation: fixed 4-byte count push, documented).
  - *NFT* — pins the carrier output to the same code script so the singleton can't escape after one hop; `transferWithData` binds `stateScript` on the ref-carrying output.
  - *TokenSwap* — adds `refValueSum($wantTokenRef) == tx.outputs[0].value` so the want-ref is provably on the maker's pinned output; `cancel()` now conserves the offer ref back to the maker.
  - *FungibleToken* — `burn()` routes the burned value to a provable `OP_RETURN`; the on-chain `stateScript.split(1)` parse asserts length + leading push byte (blocks the truncation-spoofed owner).
  - *MultiSigVault* — `spendWithMinOutput` pins `outputs[0].lockingBytecode` to a recipient and requires change back to the vault script.
  - `README.md` — dropped the false "No counterparty risk" / "Automatic supply conservation" claims, added a **TEACHING TEMPLATES — independently audit before production** banner, and documented the "token amount == satoshi value" semantic and the missing "output[i] carries ref X with value Y" opcode. Every `.rxd` carries an `// AUDIT:` header and precise `// LIMITATION:` notes; no guarantee was faked to compile.

### 11.4 Verification

Three exploit contracts that compiled before now behave correctly: the no-else bypass is **rejected**; `bool !=` emits `OP_NUMNOTEQUAL`; `9007199254740993` encodes exactly. Full suites green (545 passing, 0 failing), repo lint clean, all `dist/` rebuilt (the OP_2MUL/OP_2DIV regression shipped precisely because `dist/` was stale — not repeated here). Remaining residual limitations are documented in-code rather than silently assumed.

---

### 11.5 H-2 follow-up — full prevout verification before signing

The initial H-2 fix range-validated input satoshis but still trusted the provider's reported value/script. This follow-up closes that gap completely, because RadiantMM and RadiantSwap covenants derive payouts/splits from the value the SDK commits to the sighash. `Transaction.build()` now runs `verifyPrevouts()` **before signing** (default-on; opt out with `.withoutPrevoutVerification()` for offline signing):

1. **Authenticated fetch.** Each input's source transaction is fetched once per unique txid (in parallel) and its display txid is re-derived as `reverse(hash256(rawtx))`. If it doesn't equal the outpoint txid the spender already committed to, it's rejected. This is the crux: a malicious provider **cannot** forge a source tx with altered values, because the forgery would no longer hash to the committed txid — so the value/script assertions below are trustworthy even against a fully hostile provider, not just a buggy one.
2. **Outpoint range.** `vout` must index an existing output of the source tx.
3. **Value match.** The prevout's 8-byte LE value must equal the `satoshis` being signed (libauth 1.19 decodes output value as `Uint8Array`; compared byte-for-byte against `bigIntToBinUint64LE(satoshis)`).
4. **Script match.** The prevout `lockingBytecode` must equal the script being unlocked — the contract's P2SH script (`addressToLockScript(this.address)`) for covenant inputs, or the P2PKH script of the signing key for `experimentalFromP2PKH` inputs. This rejects a UTXO that doesn't belong to the address being spent.
5. **Consensus money range.** `assertMoneyRange` requires every committed value to be an integer in `[0, MAX_MONEY]`, where the new [`MAX_MONEY`](packages/cashscript/src/constants.ts) constant is Radiant's `Amount::max()` = `2,100,000,000,000,000,000` photons (21e9 RXD × 1e8 — 1000× Bitcoin; sourced from Radiant-Node `src/amount.h`).

The H-3 txid derivation was factored into a shared `computeDisplayTxid` used by both `getTxDetails` and `verifyPrevouts`. **11 new tests** in [`Transaction.test.ts`](packages/cashscript/test/Transaction.test.ts) cover the happy path, each rejection branch (value mismatch, wrong script, unauthenticated/forged source tx, missing vout, unfetchable source, the opt-out), and the `MAX_MONEY` boundary; the value-equality assertion was mutation-verified to fail when disabled. Existing fee/signing tests that use synthetic UTXOs call `.withoutPrevoutVerification()`. **End state: 449 root + 96 cashscript = 545 passing, 0 failing.**

---

*End of 2026-06-04 red-team pass.*

---

## 12. 2026-06-09 Covenant safety hardening (lint pass + stdlib + SDK) — build→redteam→fix loop

This pass answers "are covenants well-defined and secure?" with engineering. **Verdict going in:** Radiant covenant *primitives* (native introspection + references + state scripts) are well-defined and faithfully mapped to consensus, but the covenant *programming model is powerful-and-unguarded* — security rested entirely on the author manually asserting a complete invariant set, which is why every shipped example template had been exploitable. This pass adds the missing guardrails and proves them under a multi-round red-team.

**End state: 509 root (cashc + utils) + 125 cashscript = 634 tests passing, 0 failing; `npm run lint` clean; all three `dist/` rebuilt; all 5 covenant-stdlib + 5 legacy example contracts compile; stdlib lints at 0 warnings with NO suppressions.**

### 12.1 Covenant lint pass (`packages/cashc/src/semantic/CovenantLintTraversal.ts`)

A new semantic traversal (run after `EnsureFinalRequireTraversal`) emits heuristic WARNINGS for covenant footguns. Default mode `warn` (attached to the artifact, printed to stderr by the CLI; stdout JSON stays clean); `CompileOptions.covenantLint: 'off'|'warn'|'error'` and a `--strict` CLI flag escalate to a build failure. Comment-directive suppression (`// covenant-lint-disable[-line|-next-line] [rule]`) with an unknown-rule meta-warning and a single canonical rule-name set shared with the rule definitions.

**Nine rules.** Initial 5: `unconstrained-outputs`, `dead-computed-value`, `aggregate-only`, `missing-continuity`, `auth-only-spend`. Added after the red-team proved the linter was a syntactic-presence checker that would not catch its own stdlib's bugs: **`missing-value-conservation`** (the #1 footgun — outputs/refs constrained but input↔output value never related), **`per-active-input-conservation`** (value read from `this.activeInputIndex` with no tx-wide aggregate and no anti-co-spend `tx.inputs.length` bound — the exact AtomicSwap/Vault exploit class), **`continuity-count-trivial`** (a `codeScriptCount`/`refOutputCount` continuity check compared to a vacuous constant), and a strengthened `dead-computed-value` (a tautology/range-guard no longer counts as "use"). The `aggregate-only`/`unconstrained-outputs` heuristics were refined to stand down on a **key-aware balanced conservation identity** (`*ValueSum`/`*Count` aggregates with matching keys on both sides of `==`), so the canonical fungible-conservation pattern lints clean without suppression.

### 12.2 Covenant standard library (`examples/covenant-stdlib/`)

Five GOLD-STANDARD, fully-constrained, lint-clean reference covenants — `SingletonNFT`, `FungibleToken`, `Vault`, `StatefulCounter`, `AtomicSwap` — plus a `README.md` authoring guide (the invariant checklist, the "build the expected output then assert equality" idiom, the aggregate-vs-pinned-output trap, the satoshi==amount semantic, and **invariant #0: bound `tx.inputs.length` OR conserve over a tx-wide aggregate — never reason about `activeInputIndex` value alone**). Every contract carries an `// AUDIT:` header and precise `// LIMITATION:` notes where an opcode genuinely can't express an invariant.

### 12.3 SDK covenant support (`packages/cashscript/`)

- **Output-template helpers + `withExactOutputs()`** — declare the exact output set from one source of truth; `build()` asserts the final set (after change) matches byte-exact, so the builder and the on-chain covenant cannot silently disagree.
- **`preflight()` / `send({preflight:true})`** — a bounded, honest structural pre-broadcast check (dust, fee bounds, counts, value conservation, output-template match, optional provider `testMempoolAccept`). Documented loudly as NOT a consensus VM.
- **Dead BCH preimage-covenant path removed** and the `Contract` constructor now rejects any truthy `abiFunction.covenant` artifact (Radiant uses reference-based introspection; the compiler never sets the flag). The now-stale L-2 mixed-hashtype guard was removed (each covenant signature is signed over its own per-arg sighash and validates independently).
- **`toRegExp` fix** — `MAX_PATTERN_LENGTH` 500→2000; the 500 cap had made `buildError` throw "Pattern too long" on every `send()` failure, masking the real reason (the RadiantMM/RadiantSwap error path).

### 12.4 The red-team loop (the value of build→redteam→fix→repeat)

- **Round 1** (independent agents, grounded in Radiant-Core consensus source): the "gold-standard" stdlib was NOT sound — **AtomicSwap.executeSwap CRITICAL** (taker drains N offers for one `wantAmount` by co-spending two offer-carrying covenant UTXOs), **Vault.pay HIGH** (two equal-value vault UTXOs co-spent → one burned to fee / miner-collusion theft), **FungibleToken.transfer MEDIUM** (malformed continuation state bricks the UTXO). Shared root cause: reasoning about `activeInputIndex` value without an `inputs.length` bound or tx-wide aggregate. The linter was found to be syntactic-only — it had **no value-conservation rule** and would not have caught its own stdlib's CRITICAL bug. *Fixed:* AtomicSwap `+= require(tx.inputs.refOutputCount($offerTokenRef) == 1)`; Vault `+= require(tx.inputs.length == 1)` and a pinned `emergencyRecover` to a constructor `recoveryPkh`; FungibleToken split into a state-binding single-recipient `transfer` + a documented `transferMulti`; linter gained the 4 new rules above.
- **Round 2** (convergence red-team): the stdlib fixes were confirmed solid and consensus-grounded, but the NEW linter rules had **4 false negatives** — most importantly the conservation-identity refinement was **key-blind** (`codeScriptValueSum(cshA) == codeScriptValueSum(cshB)` with mismatched keys accepted as conservation → a value-leaking covenant lints clean), plus vacuous-guard bypasses (`tx.inputs.length >= 1`, count `< 1`/`> -1`). *Fixed (FIX-D):* the refinement is now key-aware (fail-safe — opaque keys never match), and the count/`inputs.length` comparisons are normalized against their known sign before being treated as constraints.
- **Convergence** independently verified: the upgraded linter now flags every red-team repro (incl. `per-active-input-conservation` on the exact AtomicSwap/Vault class), the key-blind and vacuous-guard exploits are caught, and the 5 stdlib contracts stay at 0 warnings (no new false positives).

The headline lesson, now encoded in tooling: **a covenant that reasons about `this.activeInputIndex` without bounding `tx.inputs.length` or conserving over a tx-wide aggregate is exploitable whenever two identical covenant UTXOs are co-spent** — and the linter now catches it.

---

*End of 2026-06-09 covenant safety hardening.*

---

## 13. 2026-06-09 Covenant verification round 2 — regtest consensus proofs + RT-3

A second loop: another red-team pass plus **on-chain consensus verification** against the real Radiant v3.1.0 node (`Radiant-Core/build/src/radiantd -regtest`, all ref/introspection opcodes active at height ≥ 111).

### 13.1 Regtest consensus proofs (`tools/regtest/covenant-cospend/`)

The two round-1 exploit classes — and the FIX-A fixes — were proven at the **consensus** level, not just analytically. For each, a *buggy* and a *fixed* covenant were deployed as bare scripts via `@radiant-core/radiantjs`, then a legitimate spend and the co-spend attack were broadcast:

| Mechanism | Buggy | Fixed |
|---|---|---|
| **Value co-spend** — `require(tx.inputs.length == 1)` (`OP_TXINPUTCOUNT`; Vault HIGH) | co-spend **ACCEPTED** (one UTXO burned to fee — exploit real on-chain) | co-spend **REJECTED** by consensus (`mandatory-script-verify-flag-failed`, `OP_NUMEQUALVERIFY`) |
| **Ref co-spend** — `require(tx.inputs.refOutputCount(ref) == 1)` (`OP_REFOUTPUTCOUNT_UTXOS`; AtomicSwap CRITICAL) | 2-offer co-spend **ACCEPTED** (drain real on-chain) | 2-offer co-spend **REJECTED** by consensus |

The legitimate single-input spend is ACCEPTED for both variants, so each fix rejects only the attack. The minimal models emit the same guard opcodes as the shipped `examples/covenant-stdlib/{Vault,AtomicSwap}.rxd`, so the consensus behaviour transfers. Harnesses + models retained for regression.

### 13.2 RT-3 red-team — verified the stdlib *logic* is consensus-sound; found 3 NEW tooling gaps

Grounded in Radiant-Core source (`validation.h validatePushRefRule` / `validateDisallowedSiblingsRefRule`, `script_execution_context.h codeScriptHash`, `interpreter.cpp`), RT-3 confirmed the five stdlib covenants are sound: SingletonNFT's singleton uniqueness is real (consensus disallow-sibling rule), StatefulCounter's `bytes4`/`OP_NUM2BIN` state encoding is non-malleable and range-guarded, and the `codeScriptHash`-excludes-state grouping is handled correctly. The new findings were all in tooling:

- **[HIGH] L-1 (linter) `state-bound-to-noncarrier`** — a covenant pinning code/value/ref continuity to `outputs[i]` but binding the next state to `outputs[j≠i]` left the real carrier's state unconstrained and lint-clean. *Fixed (FIX-E):* warn when a `stateScript` binding targets an index other than the single pinned continuation carrier.
- **[HIGH] L-2 (linter) `forwarded-ref-uncontained`** — because the consensus push-ref rule is only a subset check (output-refs ⊆ input-refs), a non-singleton ref forwarded via `pushInputRef` but never constrained by `refOutputCount` (or a `codeScriptCount==refOutputCount` stitch) can be split into a foreign script; this lint-clean. *Fixed (FIX-E):* warn on a forwarded non-singleton ref whose output containment is never pinned (singletons exempt — consensus-unique).
- **[MEDIUM] SDK-1** — `OutputTemplate.resolveOutput` prepended `stateScript` verbatim with no `OP_STATESEPARATOR`, contradicting its doc and `RadiantHelpers.buildStatefulOutput`; a doc-following caller got a malformed stateful output (`stateSeparatorByteIndex==0`), so `preflight`/`withExactOutputs` gave false confidence (fail-safe — rejected on-chain). *Fixed (FIX-F):* `resolveOutput` now delegates to `buildStatefulOutput` (byte-identical), docs corrected, size-accounting updated.

### 13.3 End state

**516 root (cashc + utils) + 128 cashscript = 644 tests passing, 0 failing; `npm run lint` clean; all `dist/` rebuilt; 5 covenant-stdlib contracts at 0 lint warnings (no suppressions); 2 consensus-level co-spend proofs green.** The covenant lint pass now carries 11 rules; the two round-1 exploit mechanisms are proven rejected by the real consensus VM.

---

*End of 2026-06-09 covenant verification round 2.*
