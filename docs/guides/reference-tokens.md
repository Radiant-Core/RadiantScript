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
