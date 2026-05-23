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
- `@/Users/macbookair/CascadeProjects/RadiantScript/packages/cashscript/test/fixture/p2pkh-invalid.json:27` — contains a literal `bchtest:` address string. Re-encode as base58 or note that this is the *invalid* fixture (used to assert compiler rejection) and unrelated to address roundtrip.
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

*End of audit.*
