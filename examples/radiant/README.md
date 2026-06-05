# Radiant Example Contracts

> ## ⚠️ TEACHING TEMPLATES — NOT PRODUCTION-READY
>
> These contracts exist to **demonstrate** Radiant's reference tokens, native
> introspection, and state separator. They are deliberately small and readable.
> **They are NOT audited, and several guarantees that read as "complete" are
> only partial.** Each `.rxd` file carries an `// AUDIT:` header and explicit
> `// LIMITATION:` notes describing exactly what is and is not enforced.
>
> **Before putting any of these near real money, you MUST independently audit
> and adapt them.** Copy-pasting them as-is will propagate under-constrained
> patterns into production.

This directory contains example contract templates for Radiant.

## Critical semantic: token amount == satoshi value

On Radiant a reference (ref) "token amount" **is the satoshi value** of the UTXO
that carries it. Introspection ops like `refValueSum`, `codeScriptValueSum`, and
`refOutputCount` operate on **satoshi value summed across outputs/inputs at the
transaction level**. There is **no opcode** that proves "output *i* carries ref
*X* with amount *Y*" in isolation.

Consequently, several guarantees you might expect are genuinely hard and must be
**over-constrained** by pinning output length + ref count + per-output
value/script **together**. Where a guarantee is not expressible with the current
opcode set, the contract says so in a `// LIMITATION:` comment rather than
faking it. Read those comments.

## Contracts

### FungibleToken.rxd
P2PKH-style fungible token keyed by a ref; ownership is the pkh embedded in each
UTXO's state, not a constructor key.
- Conserves value across the token's own code script.
- Forces every ref carrier to stay in this code script (no foreign-script escape).
- `burn()` routes the burned satoshi value to a provably-unspendable `OP_RETURN`
  output, so supply reduction is on-chain provable (not merely "not re-deposited").
- The on-chain owner parse asserts the exact `0x14 <20-byte pkh>` state shape
  before splitting, blocking a truncation-spoofed owner.
- Limitation: conservation is in aggregate over the code script; `burn()` pins
  the `OP_RETURN` at a fixed output index. See the file header.

```bash
node ../../packages/cashc/dist/main/cashc-cli.js FungibleToken.rxd
```

### NFT.rxd
Singleton NFT that stays inside its own covenant across transfers.
- Singleton via `pushInputRefSingleton` + `refOutputCount == 1`.
- Pins the carrier output to this exact code script (`codeScriptCount == 1` and
  `output[0].codeScript == own code`), so the NFT cannot escape the covenant
  after one hop.
- `transferWithData` binds the new state to the **same** ref-carrying output.
- Limitation: `ownerPk` is fixed at construction; rotating ownership requires a
  re-deploy. See the file header.

### StatefulCounter.rxd
Owner-gated singleton counter using the state separator.
- Authenticates the supplied `currentCount` against the input's own on-chain state.
- Pins exactly one same-code continuation, conserves value, and **binds the next
  state to `currentCount + 1`** so the counter must advance by exactly one.
- Limitation: count is stored as a **fixed 4-byte little-endian push**, so it is
  bounded to `0..2147483647`. Arbitrary-width state binding is not expressible
  with current opcodes — see the file header.

### MultiSigVault.rxd
2-of-3 multisig vault.
- `spendWithMinOutput` pins `output[0]` to a **fixed** recipient P2PKH with a
  minimum value, and requires change (`output[1]`) to return to the vault's own
  script — binding **where** the money goes, not just how much.
- `emergencyRecover` is timelocked to any single key.
- Limitation: the recipient is fixed at construction; the plain `spend()` has no
  output constraints. See the file header.

### TokenSwap.rxd
Atomic swap between two token references.
- Conserves both refs and pins a strict 2-output template.
- **Proves** the want-ref is carried by the maker's output via
  `refValueSum($wantTokenRef) == outputs[0].value` (the gap the earlier template
  had — conservation alone is not a swap).
- `cancel()` conserves the offer ref back to the maker.
- Limitation: `refValueSum` is transaction-level; the template assumes the maker
  takes the full want-ref value and does not model taker change for the want-ref.
  See the file header.

## Compiling

Compile any example with the bundled compiler CLI:

```bash
# from this directory
node ../../packages/cashc/dist/main/cashc-cli.js NFT.rxd

# with debug info (source maps) for rxdeb
node ../../packages/cashc/dist/main/cashc-cli.js FungibleToken.rxd --debug -o FungibleToken.json
```

Debug a compiled artifact with rxdeb:

```bash
rxdeb --artifact=FungibleToken.json --tx=<transaction_hex>
rxdeb> step
rxdeb> source
rxdeb> stack
```

## Key Radiant features used

| Feature | Opcodes | Example contract |
|---------|---------|------------------|
| Reference tracking | `pushInputRef`, `refValueSum` | FungibleToken |
| Singleton refs | `pushInputRefSingleton`, `refOutputCount` | NFT |
| State separator | `stateSeparator`, `codeScript`, `stateScript` | StatefulCounter |
| Introspection | `tx.outputs[i].value`, `tx.outputs[i].lockingBytecode` | MultiSigVault |
| Cross-ref verification | Multiple `pushInputRef`, `refValueSum` | TokenSwap |

## Contract patterns (and why they are not enough on their own)

### Token conservation is necessary but NOT sufficient
```radiantscript
pushInputRef($tokenRef);
require(tx.inputs.refValueSum($tokenRef) == tx.outputs.refValueSum($tokenRef));
```
Conservation alone permits a holder to split a token into an output whose script
no longer enforces your rules. Pin the carrier's code script too:
```radiantscript
bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
require(tx.outputs.codeScriptCount(csh) == tx.outputs.refOutputCount($tokenRef));
```

### Singleton enforcement plus carrier pinning
```radiantscript
pushInputRefSingleton($nftRef);
require(tx.outputs.refOutputCount($nftRef) == 1);
require(tx.outputs[0].codeScript == tx.inputs[this.activeInputIndex].codeScript);
```

### Binding a value to a specific output
Because there is no "output[i] carries ref X with amount Y" opcode, equate the
whole transaction-level ref sum to a single pinned output's value, and pin its
script/length too:
```radiantscript
require(tx.outputs.length == 2);
require(tx.outputs.refOutputCount($wantTokenRef) == 1);
require(tx.outputs.refValueSum($wantTokenRef) == tx.outputs[0].value);
```

## See Also

- [Debugging with rxdeb](../../docs/guides/debugging-with-rxdeb.md)
- [RadiantScript Language Reference](../../website/docs/language/)
- [rxdeb Repository](https://github.com/Radiant-Core/rxdeb)
