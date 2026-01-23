---
title: What is Radiant?
sidebar_label: About Radiant
---

Radiant (RXD) is a peer-to-peer digital asset system that extends the UTXO model with powerful features like reference-based tokens and transaction introspection. It uses a *blockchain* to distribute its ledger over a network of independent nodes with no single point of failure and no central control.

## Basics
The *blockchain* is a data structure distributed over independent nodes. It derives its name from the chain of *blocks* used to store data. All blocks include a *block header* with metadata and the root of a *Merkle tree* for quick data validation. Block headers also include a timestamp and hash of the previous block for tamper resistance.

### Proof-of-Work
Radiant uses *Proof-of-Work (PoW)* consensus. Mining involves finding a nonce that makes the block header hash match a target prefix. Mining is expensive but verification is fast.

Miners validate transactions and secure the network, receiving new coins (*block reward*) in *coinbase* transactions. This creates financial incentives for honest validation.

### Transactions
Radiant transactions use *Unspent Transaction Outputs (UTXOs)*. UTXOs are locked with a locking script (`scriptPubKey`) specifying spend conditions. To spend, an unlocking script (`scriptSig`) is provided and both scripts execute together.

The most common pattern is *Pay-to-Public-Key-Hash (P2PKH)*, where the locking script contains a public key hash and expects the unlocking script to provide a matching public key and valid signature.

UTXOs must be spent entirely. To send 1 RXD from a 10 RXD UTXO, 9 RXD must be sent back as change (minus transaction fees).

## Smart Contracts
Radiant supports advanced smart contracts through its extended script system. Key features include:

- **Reference-based tokens** - Native fungible and non-fungible tokens using refs
- **Transaction introspection** - Access to input/output data within scripts
- **State management** - State separators for persistent contract state
- **64-bit arithmetic** - Large number support for DeFi applications

### Radiant Script
Radiant extends Bitcoin Script with additional opcodes for introspection and token operations. Script is stack-based and intentionally not Turing complete, focusing on programmable money validation.

Key Radiant-specific opcodes include:
- `OP_PUSHINPUTREF` / `OP_REQUIREINPUTREF` - Reference token operations
- `OP_REFHASHDATASUMMARY_*` - Reference introspection
- `OP_CODESCRIPTHASH*` - Code script verification
- `OP_STATESEPARATOR*` - State management

### RadiantScript Language
RadiantScript is a high-level language that compiles to Radiant Script bytecode. It provides a familiar Solidity-like syntax while supporting all Radiant-specific features. See the [language documentation](/docs/language/) for details.
