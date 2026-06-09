# Radiant Covenant Standard Library

**Canonical, over-constrained reference covenants for RadiantScript.**

RadiantScript has **no import system** — every contract is a single file. So a
"standard library" here is not code you link against; it is a **curated, audited
set of reference covenants** plus this authoring guide. You COPY from these files,
adapt the constructor parameters and recipient pins to your case, and keep every
invariant the template enforces.

> ### Copying a *partial* pattern is how funds get stolen.
>
> Most "covenant bugs" are not exotic — they are a missing line. A contract that
> conserves value but forgets to pin the carrier's code script lets a holder move
> the token into a script that drops your rules. A swap that conserves the
> want-token but never pins it to the *maker's* output lets the taker keep both
> sides. **A `checkSig` with no output constraints sends funds anywhere.** These
> templates are deliberately stricter than they "need" to be. Do not delete
> constraints to make a transaction builder's life easier — relax them only when
> you can state, in writing, why the relaxed version is still safe.

Every `.rxd` here compiles cleanly with the bundled compiler and is written to
emit **zero covenant-lint warnings**: bounded output count, pinned outputs,
asserted continuity, bound state.

---

## The covenant invariant checklist

Every reference covenant explicitly addresses **all of these that apply**. When you
write or review a covenant, walk this list line by line. If an item does not apply,
say so in a comment — do not leave it silently unaddressed.

| # | Invariant | What it means | Why omitting it is fatal |
|---|-----------|---------------|--------------------------|
| **0** | **Bound the INPUT set OR conserve tx-wide — never reason about `activeInputIndex` value alone** | `require(tx.inputs.length == 1)` **OR** `require(tx.inputs.refOutputCount(ref) == 1)` **OR** conserve over a tx-wide aggregate (`codeScriptValueSum` / `refValueSum` over ALL inputs). | **This is the #1 lesson.** A covenant that reasons about *this* input's value/state (`tx.inputs[this.activeInputIndex].value`, per-active-input conservation) but neither bounds `tx.inputs.length` nor conserves over a tx-wide aggregate is exploitable whenever **two identical covenant UTXOs** (same code/params → same script) are **co-spent in one tx**: each input evaluates *independently* against the shared outputs, so one shared payout satisfies *both* evaluations. This silently steals/burns the second UTXO (AtomicSwap offer-merge theft, Vault fee-burn). The `*ValueSum` / `*Count` aggregates sum over **all** inputs/outputs tx-wide, NOT per-active-input — use them, or pin the input count. |
| **1** | **Output-set bound** | `require(tx.outputs.length == N)` | An open-ended output set is an attacker's playground: they can append outputs you never reasoned about. If you cannot fix N, you must instead constrain the *aggregate* (count + value sum) so the unbounded tail carries nothing that matters. |
| **2** | **Value conservation** | sats/ref in == out (+ an explicit, bounded fee), via `codeScriptValueSum` / `refValueSum` | Without it the spender can mint supply (out > in) or burn it to fees. Fees must be an explicit, ceiling-bounded argument — never an unaccounted remainder. |
| **3** | **Recipient / script pin** | `outputs[i].lockingBytecode == <expected>` (or `.codeScript`) for each value-bearing output | Conservation says "the right *total* leaves" — it does **not** say *where* it goes. The pin says who receives it. Build the expected script in-script and assert equality. |
| **4** | **Covenant continuity** | `codeScriptCount(hash256(codeScript)) == 1` (or `== refOutputCount`) | If the covenant is not carried forward, it escapes after one hop into a script with none of these rules. This is the single most-forgotten invariant. |
| **5** | **State transition binding** | `outputs[i].stateScript == <encoded next state>` where next = f(current) | The next state must be a deterministic function of the current state, computed in-script — not a value the attacker pastes into the output. Authenticate the *current* state from the input first, or the binding is meaningless. |
| **6** | **Ref pinning** | aggregate (`refOutputCount == 1`) **stitched** to a pinned output (`refValueSum == outputs[i].value`) | The aggregate alone proves "one output somewhere carries the ref"; the stitch proves it is *this* output. See "The aggregate-vs-pinned-output trap" below. |
| **7** | **Authorisation alone is NOT a constraint** | a `checkSig` / `checkMultiSig` with no output constraints lets funds go anywhere | Signature checks answer "may this party act?", never "what may they do?". Every auth check in these templates is paired with the output constraints above. |

---

## Two semantics you MUST internalise

### 1. On Radiant, **token amount == satoshi value**

A reference carrier's "token amount" **is the satoshi value** of the UTXO that
carries it. The introspection aggregates all operate on satoshi value summed across
inputs/outputs **at the transaction level**:

- `tx.outputs.refValueSum(ref)` — sum of satoshi values of all outputs carrying `ref`.
- `tx.outputs.refOutputCount(ref)` — how many outputs carry `ref`.
- `tx.outputs.codeScriptValueSum(hash)` — sum of satoshi values of all outputs with that code script.
- `tx.outputs.codeScriptCount(hash)` — how many outputs have that code script.

There is **no opcode** that proves "output *i* carries ref *X* with amount *Y*" in
isolation. Conservation and counting are aggregate, transaction-level facts.

### 2. The aggregate-vs-pinned-output trap

Because the aggregate is transaction-level, this is **NOT** a swap:

```radiantscript
// BROKEN: conserves the want-token but never says WHERE it goes.
pushInputRef($wantTokenRef);
require(tx.inputs.refValueSum($wantTokenRef) == tx.outputs.refValueSum($wantTokenRef));
```

The taker can satisfy "want in == want out" by sending the want-token **back to
themselves**. To prove the want-token reached the *maker*, you **stitch** the
aggregate to a specific, pinned output:

```radiantscript
// SOUND: force the want-ref into exactly one output, then pin THAT output.
require(tx.outputs.length == 2);
require(tx.outputs.refOutputCount($wantTokenRef) == 1);            // exactly one carrier
bytes25 makerLock = new LockingBytecodeP2PKH(makerPkh);
require(tx.outputs[0].lockingBytecode == makerLock);              // that carrier is the maker's
require(tx.outputs.refValueSum($wantTokenRef) == tx.outputs[0].value); // and holds the whole sum
```

The same stitch applies to code-script covenants. To prove "the singleton stays in
this covenant *and* is output[0]":

```radiantscript
bytes myCode = tx.inputs[this.activeInputIndex].codeScript;
bytes32 csh = hash256(myCode);
require(tx.outputs.refOutputCount($nftRef) == 1);   // one ref carrier
require(tx.outputs.codeScriptCount(csh) == 1);      // one code carrier
require(tx.outputs[0].codeScript == myCode);        // and it is output[0]
```

Because there is exactly one ref carrier and exactly one code carrier, and
output[0] is the code carrier, output[0] is provably the ref carrier too.

### 3. The co-spend (identical-covenant-merge) trap — invariant #0

Two UTXOs locked by the **same covenant code with the same parameters** have the
**same locking script**. Consensus lets them be spent in the **same transaction**,
and the script for each input is evaluated **independently** against the one shared
set of outputs. If your covenant only checks *this* input's value/state against the
outputs, a **single** shared payout satisfies **every** co-spent input at once:

```radiantscript
// BROKEN: conserves only the ACTIVE input's value, no input-set bound.
int inputValue = tx.inputs[this.activeInputIndex].value;
require(tx.outputs[0].value + tx.outputs[1].value + fee == inputValue);
// Co-spend two equal-value (V) vault UTXOs: outputs sum to V, so this passes for
// BOTH inputs — but tx-in is 2V, so a whole vault UTXO is burned to the miner fee.
```

Normal `pushInputRef` makes this **worse**: it is **not** consensus-unique or
value-conserved — only the set-difference rule (output-refs ⊆ input-refs) applies.
So two UTXOs carrying the same offer ref can be merged and one offer stolen
(AtomicSwap). The fixes are exactly invariant #0:

```radiantscript
// SOUND (pick one that fits the archetype):
require(tx.inputs.length == 1);                          // single-UTXO spend (Vault.pay)
require(tx.inputs.refOutputCount($offerTokenRef) == 1);  // one input carries the ref (AtomicSwap)
// ...or conserve over a tx-wide aggregate instead of the active input:
require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
```

`pushInputRefSingleton` IS consensus-unique (at most one output carrier), so a
singleton covenant gets part of this for free — but a normal-ref or per-input-value
covenant must bound the input set or aggregate explicitly.

---

## The core idiom: **build the expected output, then assert equality**

Do not test outputs piecemeal with inequalities and hope the gaps are covered.
Reconstruct the exact bytes you expect and compare:

```radiantscript
// Recipient pin: build the P2PKH you expect, assert the output equals it.
bytes25 recipientLock = new LockingBytecodeP2PKH(recipientPkh);
require(tx.outputs[0].lockingBytecode == recipientLock);

// State binding: build the next state from the current one, assert equality.
require(tx.outputs[0].stateScript == 0x04 + bytes4(currentCount + 1));

// Continuity: build the code hash, assert exactly one output carries it.
bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
require(tx.outputs.codeScriptCount(csh) == 1);
```

Helpers you will use to build expected scripts/state:

- `new LockingBytecodeP2PKH(pkh)` → standard P2PKH locking script (`bytes25`).
- `new LockingBytecodeNullData([...])` → standard `OP_RETURN` nulldata (provably unspendable; use it to prove burns).
- `0x14 + pkh`, `0x04 + bytes4(n)` → reconstruct a state script's push (`0x14` = 20-byte push opcode, `0x04` = 4-byte push opcode).
- `hash160(pk)`, `hash256(code)` → derive the pkh / code-script hash to compare against.

### Authenticate before you bind

State that the spender hands you is **untrusted** until you authenticate it against
the input's own on-chain state:

```radiantscript
bytes state = tx.inputs[this.activeInputIndex].stateScript;
require(state.length == 21);              // assert the EXACT shape first...
require(state.split(1)[0] == 0x14);       // ...so a truncated state can't spoof...
bytes20 ownerPkh = bytes20(state.split(1)[1]);  // ...the owner you read out.
```

Asserting the exact length and push byte **before** splitting blocks a
truncation/oversize attack where a shorter state is spliced to impersonate a
different owner.

---

## Reference contracts → invariant coverage

| Contract | Archetype | #0 input bound | #1 out bound | #2 conserve | #3 pin | #4 continuity | #5 state | #6 ref pin | #7 auth+constrain |
|----------|-----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **SingletonNFT.rxd** | Singleton ref, on-chain owner rotation | ✅ (singleton) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **FungibleToken.rxd** | Supply conservation + provable burn | ✅ (aggregate) | ✅ (transfer/burn) | ✅ | ✅ | ✅ | ✅ (transfer) | ✅ (transfer/burn) | ✅ |
| **Vault.rxd** | Multisig + recipient pin + change-back | ✅ (`inputs.length==1`) | ✅ | ✅ | ✅ | — | — | — | ✅ |
| **StatefulCounter.rxd** | State machine, next = current + 1 | ✅ (singleton) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **AtomicSwap.rxd** | Want-ref pinned to maker's output | ✅ (`inputs.refOutputCount==1`) | ✅ | ✅ | ✅ | — | — | ✅ | ✅ |

A `—` means the invariant **does not apply** to that archetype (e.g. Vault holds no
ref, so #6 is N/A). It never means "skipped". Each file's header states exactly
which apply and why, and carries a precise `// LIMITATION:` / `// AUDIT:` note
wherever an opcode genuinely cannot express something (rather than faking it).

> **2026-06-09 audit fixes (co-spend / state-brick).** Three covenants were hardened
> against the invariant-#0 co-spend trap and a state-brick grief:
> - **AtomicSwap** (CRITICAL): two identical offer covenants could be co-spent and
>   the taker released both offers for one payment. Fixed by
>   `require(tx.inputs.refOutputCount($offerTokenRef) == 1)` in `executeSwap`
>   (and `cancel`, defense-in-depth).
> - **Vault** (HIGH): two equal-value vault UTXOs could be co-spent, burning one to
>   the miner fee. Fixed by `require(tx.inputs.length == 1)` in `pay`.
>   `emergencyRecover` is now pinned to a constructor-fixed `recoveryPkh` (no longer
>   spend-anywhere after the timelock).
> - **FungibleToken** (MEDIUM): the default `transfer` is now single-recipient and
>   binds a well-formed `0x14<pkh>` next-owner state, so it cannot brick the carrier
>   it forwards. The open fan-out moved to `transferMulti`, where the builder owns
>   state well-formedness (documented `// LIMITATION`).

---

## Documented limitations (read these — they are real)

- **No "output[i] carries ref X with amount Y" opcode.** All ref/code facts are
  transaction-level aggregates; covenants stitch them to pinned outputs (above).
- **State width is fixed.** There is no opcode to bind an arbitrary-width
  minimally-encoded script number into state and read it back. `StatefulCounter`
  pins a fixed 4-byte push and range-guards the value so it cannot wrap.
- **Fixed recipients can't be arguments.** `Vault` pins one constructor-fixed
  recipient; a general spend-anywhere multisig cannot bind the recipient without
  accepting it as a spoofable argument. That is a design tradeoff, not a bug.
- **Burn destination is fixed by index.** `FungibleToken.burn` pins the `OP_RETURN`
  at output[1]; the transaction builder must produce that layout.
- **Singleton paths fund fees from a separate input.** Contracts that pin
  `tx.outputs.length == 1` (e.g. `SingletonNFT`, `StatefulCounter`, and the default
  single-recipient `FungibleToken.transfer`) expect the miner fee to come from a
  separate, plain input; the open-length variant (`FungibleToken.transferMulti`)
  derives its singleton guarantee from `codeScriptCount` instead of a fixed count.
- **Co-spend / identical-covenant merge (invariant #0).** A covenant that reasons
  about the active input's value/state must bound `tx.inputs.length` or conserve
  over a tx-wide aggregate, or two identical covenant UTXOs can be merged in one tx
  and one silently stolen/burned. `Vault.pay` pins `tx.inputs.length == 1`;
  `AtomicSwap` pins `tx.inputs.refOutputCount($offerTokenRef) == 1`.

---

## Compiling

```bash
# from the repo root
node packages/cashc/dist/main/cashc-cli.js examples/covenant-stdlib/SingletonNFT.rxd

# with debug info (source maps) for rxdeb
node packages/cashc/dist/main/cashc-cli.js examples/covenant-stdlib/FungibleToken.rxd --debug -o FungibleToken.json
```

All five contracts compile with exit status 0 and no errors against the bundled
compiler (`rxdc 1.1.1-v2`).

## See also

- `../radiant/` — the earlier teaching templates these were promoted from.
- `../../packages/cashc/test/valid-contract-files/radiant.rxd` — the full Radiant introspection opcode surface, as valid syntax.
- `../../website/docs/language/` — the RadiantScript language reference.
