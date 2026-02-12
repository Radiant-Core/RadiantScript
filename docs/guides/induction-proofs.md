# Induction Proofs in RadiantScript

Radiant provides two independent mechanisms for mathematical induction proofs, enabling
contracts to verify provenance and enforce rules across transaction boundaries in O(1)
constant time and space.

## Method 1: Reference-Based Induction

The `pushInputRef` family of statements creates an unbroken chain of provenance from a
genesis (mint) transaction to the current UTXO. This is the primary mechanism used by
all Glyph token contracts.

### How It Works

1. **Base case P(0):** At genesis, `pushInputRef(ref)` is valid only if `ref` matches
   one of the input outpoints being spent (the mint transaction).
2. **Inductive step P(k→k+1):** On every subsequent spend, the ref is valid only if at
   least one parent input's output script already contains that same reference.
3. **Result:** Only the immediate parent inputs need to be checked — no history traversal.

### Reference Statements

| RadiantScript | Opcode | Purpose |
|---------------|--------|---------|
| `pushInputRef(ref)` | `OP_PUSHINPUTREF` | Push & propagate a 36-byte reference |
| `requireInputRef(ref)` | `OP_REQUIREINPUTREF` | Require reference exists (don't propagate) |
| `disallowPushInputRef(ref)` | `OP_DISALLOWPUSHINPUTREF` | Forbid reference in this output |
| `disallowPushInputRefSibling(ref)` | `OP_DISALLOWPUSHINPUTREFSIBLING` | Forbid reference in siblings |
| `pushInputRefSingleton(ref)` | `OP_PUSHINPUTREFSINGLETON` | Push + disallow siblings (NFT) |

### Code-Continuity Induction

Combine references with introspection to verify that the parent UTXO used the same
contract code. Since the parent also verified its parent, this creates an inductive chain
guaranteeing all ancestors followed the same rules:

```radiantscript
contract InductionNFT(
    bytes36 constant $nftRef,
    pubkey ownerPk
) {
    return {
        transfer(sig s) {
            require(checkSig(s, ownerPk));

            // Reference-based induction: provenance from genesis
            pushInputRefSingleton($nftRef);
            require(tx.outputs.refOutputCount($nftRef) == 1);

            // Code-continuity induction step
            bytes myCodeScript = tx.inputs[this.activeInputIndex].codeScript;
            bytes32 myCodeHash = hash256(myCodeScript);
            require(tx.outputs.codeScriptCount(myCodeHash) >= 1);
        }
    }
}
```

## Method 2: TxId v3 Preimage Induction

For general-purpose mathematical induction beyond reference tracking, Radiant supports
**Transaction Identifier Version 3**. When `nVersion == 3`, the txid is computed from a
fixed 112-byte preimage instead of the full serialized transaction, preventing exponential
size blowup when embedding parent transactions.

### TxId v3 Preimage Layout (112 bytes)

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4B | nVersion | Transaction version (LE) |
| 4 | 4B | nTotalInputs | Number of inputs (LE) |
| 8 | 32B | hashPrevoutInputs | SHA256 of all input outpoints |
| 40 | 32B | hashSequence | SHA256 of all input sequences |
| 72 | 4B | nTotalOutputs | Number of outputs (LE) |
| 76 | 32B | hashOutputHashes | SHA256 of per-output SHA256 hashes |
| 108 | 4B | nLocktime | Transaction locktime (LE) |

### Usage Pattern

The caller provides the parent transaction's v3 preimage in the unlocking script.
The contract verifies it matches the parent's txid, then inspects fields:

```radiantscript
contract InductionV3NFT(
    bytes36 constant $nftRef,
    pubkey ownerPk
) {
    return {
        transferWithProof(sig s, bytes112 parentPreimage) {
            require(checkSig(s, ownerPk));

            pushInputRefSingleton($nftRef);
            require(tx.outputs.refOutputCount($nftRef) == 1);

            // Verify preimage matches parent txid
            bytes32 derivedParentTxId = hash256(parentPreimage);
            bytes32 actualParentTxId = tx.inputs[this.activeInputIndex].outpointTransactionHash;
            require(derivedParentTxId == actualParentTxId);

            // Extract and verify parent version
            bytes4 parentVersion, bytes108 rest = parentPreimage.split(4);
            require(int(parentVersion) == 3);
        }
    }
}
```

## Transaction State Introspection

`OP_PUSH_TX_STATE` provides access to transaction-level computed values via nullary
operators in RadiantScript:

| RadiantScript | Field | Return Type | Description |
|---------------|-------|-------------|-------------|
| `tx.state.txId` | 0 | `bytes32` | Current transaction's txid (v3-aware) |
| `tx.state.inputSum` | 1 | `int` | Total input value in photons |
| `tx.state.outputSum` | 2 | `int` | Total output value in photons |

### Fee Verification Example

```radiantscript
// Verify fee is within bounds
int fee = tx.state.inputSum - tx.state.outputSum;
require(fee >= 0);
require(fee <= maxFee);
```

### Self-Referencing Contracts

`tx.state.txId` enables contracts that need to reference their own transaction identity,
useful for creating provable receipts or self-anchoring state:

```radiantscript
bytes32 myTxId = tx.state.txId;
require(myTxId != 0x0000000000000000000000000000000000000000000000000000000000000000);
```

## Choosing the Right Method

| Criterion | Method 1 (References) | Method 2 (TxId v3) |
|-----------|----------------------|---------------------|
| **Use case** | Token identity, NFTs, FTs | Arbitrary ancestor verification |
| **Complexity** | Simple — single statement | Complex — preimage parsing |
| **Data overhead** | 0 bytes in unlocking script | 112 bytes per ancestor level |
| **Verification** | Automatic by consensus | Explicit in contract logic |
| **Typical usage** | All Glyph tokens | Advanced state machines |

For most token contracts, **Method 1 with code-continuity introspection** is sufficient
and recommended. Method 2 is available for advanced use cases requiring verification of
specific structural properties of ancestor transactions.

## Complete Example

See [`examples/radiant/InductionProof.rxd`](../../examples/radiant/InductionProof.rxd) for
a comprehensive example demonstrating both methods with multiple contract patterns.
