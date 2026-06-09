# Covenant co-spend — consensus proof harness

On-chain (regtest) proof that the two round-1 covenant exploits — and the FIX-A fixes
that close them — behave as claimed against the **real Radiant v3.1.0 consensus node**,
not just analytically.

Both exploits share one root cause: *a covenant that reasons about
`this.activeInputIndex` without bounding `tx.inputs.length` or constraining a tx-wide
quantity is exploitable when two identical covenant UTXOs are co-spent* (each input
evaluates independently against the shared outputs).

## What it proves

| Harness | Fix mechanism | Buggy variant | Fixed variant |
|---|---|---|---|
| `value-cospend.cjs` | `require(tx.inputs.length == 1)` (`OP_TXINPUTCOUNT`) — Vault HIGH | co-spend **ACCEPTED** (one UTXO burned to fee) | co-spend **REJECTED** (`OP_NUMEQUALVERIFY`) |
| `ref-cospend.cjs` | `require(tx.inputs.refOutputCount(ref) == 1)` (`OP_REFOUTPUTCOUNT_UTXOS`) — AtomicSwap CRITICAL | 2-offer co-spend **ACCEPTED** (drain real) | 2-offer co-spend **REJECTED** |

In both cases the legitimate single-input spend is ACCEPTED for both variants, so the fix
rejects only the attack, not normal use.

`Mini{Vault,Ref}{Buggy,Fixed}.rxd` are minimal faithful models that isolate each
mechanism (bare covenants; the buggy `MiniVaultBuggy`/`MiniRefBuggy` also trip the
`per-active-input-conservation` lint rule, which is why they compile with
`--covenant-lint=off`). The real `examples/covenant-stdlib/{Vault,AtomicSwap}.rxd` emit
the identical guard opcodes (`OP_TXINPUTCOUNT` / `OP_REFOUTPUTCOUNT_UTXOS`), so the
consensus behaviour transfers.

## Run

```sh
# 1. start a regtest node (v3.1.0) and activate ref/introspection opcodes (height >= 111)
RT=/tmp/cov-regtest; rm -rf "$RT"; mkdir -p "$RT"
BIN=/Users/macbookair/CascadeProjects/Radiant-Core/build/src
"$BIN/radiantd" -datadir="$RT" -regtest -listen=0 -rpcport=18444 -fallbackfee=0.00001 -daemon
printf '#!/bin/zsh\nexec %s/radiant-cli -datadir=%s -regtest -rpcport=18444 "$@"\n' "$BIN" "$RT" > "$RT/rcli"; chmod +x "$RT/rcli"
"$RT/rcli" createwallet cov
"$RT/rcli" -rpcwallet=cov generatetoaddress 120 "$("$RT/rcli" -rpcwallet=cov getnewaddress)"

# 2. run the proofs (exit 0 = proof holds)
node tools/regtest/covenant-cospend/value-cospend.cjs
node tools/regtest/covenant-cospend/ref-cospend.cjs
```

Tx construction uses `@radiant-core/radiantjs` (it inlines the ref opcodes' raw 36-byte
operands correctly — cashscript's `asmToScript` does not). Min relay fee ≈ 10,000
photons/byte. See `SECURITY_AUDIT_REPORT.md` §13.
