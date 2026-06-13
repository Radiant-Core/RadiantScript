# Reference-Based Tokens

Radiant's unique reference system enables powerful token functionality without requiring separate token protocols.

## Overview

Unlike other UTXO chains that require overlay protocols (like SLP or BRC-20), Radiant has native reference tracking built into the consensus layer:

- **References** are 36-byte identifiers (txid:vout) that can be pushed onto UTXOs
- **Singleton references** guarantee exactly one UTXO holds a specific reference
- **Reference introspection** allows contracts to query reference states across inputs/outputs

## Core Operations

### pushInputRef

Pushes a reference onto the current output, allowing token tracking:

```radiantscript
bytes36 ref = pushInputRef($tokenRef);
```

### pushInputRefSingleton

Ensures only ONE output can hold this reference (for NFTs):

```radiantscript
pushInputRefSingleton($nftRef);
```

### requireInputRef

Requires that a specific reference exists in the inputs:

```radiantscript
requireInputRef($expectedRef);
```

## Fungible Token Pattern

```radiantscript
pragma radiantscript ^0.9.0;

contract FungibleToken(bytes36 constant $tokenRef, pubkey ownerPk) {
    function transfer(sig s) {
        require(checkSig(s, ownerPk));
        
        // Track the token reference
        pushInputRef($tokenRef);
        
        // Conservation: input tokens == output tokens
        int inputSum = tx.inputs.refValueSum($tokenRef);
        int outputSum = tx.outputs.refValueSum($tokenRef);
        require(inputSum == outputSum);
    }
}
```

**Key points:**
- `refValueSum` returns the total satoshi value of UTXOs holding this reference
- Conservation rule prevents token creation/destruction
- Token "amount" is represented by satoshi value

## Non-Fungible Token (NFT) Pattern

```radiantscript
pragma radiantscript ^0.9.0;

contract NFT(bytes36 constant $nftRef, pubkey ownerPk) {
    function transfer(sig s) {
        require(checkSig(s, ownerPk));
        
        // Singleton ensures only ONE output has this ref
        pushInputRefSingleton($nftRef);
        
        // Verify exactly one output
        require(tx.outputs.refOutputCount($nftRef) == 1);
    }
}
```

**Key points:**
- `pushInputRefSingleton` enforces uniqueness at consensus level
- Only one UTXO can ever hold this reference
- Perfect for collectibles, deeds, identities

## Reference Introspection Functions

| Function | Description |
|----------|-------------|
| `tx.inputs.refValueSum(ref)` | Sum of values for inputs with ref |
| `tx.outputs.refValueSum(ref)` | Sum of values for outputs with ref |
| `tx.inputs.refOutputCount(ref)` | Count of inputs with ref |
| `tx.outputs.refOutputCount(ref)` | Count of outputs with ref |
| `tx.inputs.zeroValue.refOutputCount(ref)` | Count of zero-valued inputs with ref |
| `tx.outputs.zeroValue.refOutputCount(ref)` | Count of zero-valued outputs with ref |
| `tx.inputs.refHashValueSum(ref)` | Hash-based value sum (advanced) |
| `tx.outputs.refHashValueSum(ref)` | Hash-based value sum (advanced) |

## ⚠️ Constraint: there is NO global circulating-supply read

`refValueSum` (and every function in the table above) sums **only the carriers spent or created in the current transaction** — `tx.inputs.refValueSum($ref)` sums co-spent inputs, `tx.outputs.refValueSum($ref)` sums created outputs. **Radiant has no opcode that reads the global circulating supply `S` of a fungible ref across the whole UTXO set.** A spender chooses which of their own carriers to co-spend, so they *set* the value any covenant sees.

This breaks any covenant that needs a **supply-relative rate** — a payout or mint computed against the global total `S`:

```radiantscript
// ❌ DRAINABLE — do NOT do this
int S_seen = tx.inputs.refValueSum($shareRef);   // NOT global supply — only what the spender co-spent
int payout = burned * R / S_seen;                 // proportional burn payout
```

A burner who co-spends **only their own** shares makes `S_seen == their own stake`, so `payout = burned * R / burned = R` — the entire reserve drains in one transaction. The mirror image, a proportional mint `minted = dR * S / R`, bricks on an honest add when `S_seen` is 0 (no passthrough carrier co-spent).

### ✅ Safe pattern: pin a 1:1 collateral DELTA, never an absolute sum

The audited pattern used by RadiantSwap's [`Market.rxd`](../../../RadiantSwap/contracts/Market.rxd) `split`/`merge` is to pin a ref-value **delta** to a co-spent **collateral delta** — never to read an absolute `refValueSum`:

```radiantscript
// ✅ SAFE — mint/burn pinned 1:1 to the collateral delta
int n = tx.outputs[0].value - tx.inputs[0].value;                       // collateral added (split) ...
require(n > 0);
require(tx.outputs.refValueSum($shareRef) - tx.inputs.refValueSum($shareRef) == n);   // ... mints exactly n
```

A **delta** is presence- and padding-invariant: any passthrough carrier the spender adds appears in *both* the input sum and the output sum, so it cancels. The spender cannot influence the result by choosing what to co-spend. Burn is the symmetric `n = in[0].value - out[0].value` with the inputs−outputs delta.

**Rule of thumb:** express every covenant check as a value/ref **delta** (`out − in == n`). If you find yourself reading an absolute `refValueSum` and dividing by it for a rate, stop — that quantity is spender-selectable, not the global supply. Fully-proportional LP/share models (Uniswap's `dR·S/R`) are blocked on this missing primitive; see RadiantMM's `docs/LP-SHARE-COVENANT-DESIGN.md` for the trustless workaround (an authenticated in-controller `shareTotal` scalar, every mutation delta-pinned).

## Token Minting

To mint new tokens, create a genesis transaction that:
1. Has no prior reference (first use of this txid:vout)
2. Pushes the reference to outputs

```radiantscript
// In the minting transaction, $tokenRef is this transaction's outpoint
pushInputRef($tokenRef);
```

## Advanced: Cross-Token Operations

```radiantscript
// Atomic swap between two token types
pushInputRef($tokenA);
pushInputRef($tokenB);

// Verify both tokens are conserved
require(tx.inputs.refValueSum($tokenA) == tx.outputs.refValueSum($tokenA));
require(tx.inputs.refValueSum($tokenB) == tx.outputs.refValueSum($tokenB));
```

## See Also

- [FungibleToken.rxd](../../examples/radiant/FungibleToken.rxd) - Complete implementation
- [NFT.rxd](../../examples/radiant/NFT.rxd) - NFT implementation
- [TokenSwap.rxd](../../examples/radiant/TokenSwap.rxd) - Atomic swap example
