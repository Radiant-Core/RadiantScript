# Radiant Developer Tools Ecosystem

A comprehensive suite of tools for developing smart contracts on the Radiant blockchain.

## Overview

| Tool | Purpose | Repository |
|------|---------|------------|
| **RadiantScript** | High-level smart contract language | [Radiant-Core/RadiantScript](https://github.com/Radiant-Core/RadiantScript) |
| **rxdc** | RadiantScript compiler CLI | Part of RadiantScript |
| **rxdeb** | Script debugger with step-through execution | [rxdeb](https://github.com/Radiant-Core/rxdeb) |
| **radiantjs** | JavaScript library for Radiant | [radiantblockchain/radiantjs](https://github.com/radiantblockchain/radiantjs) |
| **radiantblockchain-constants** | Shared opcodes, limits, network params | [@radiantblockchain/constants](https://github.com/radiantblockchain/radiantblockchain-constants) |

## Quick Start

### 1. Write a Contract (`.rxd` file)

```solidity
// token.rxd
pragma rxd ^0.1.0;

contract SimpleToken(bytes20 owner, bytes32 ref) {
    function transfer(pubkey pk, sig s, bytes20 newOwner) {
        require(hash160(pk) == owner);
        require(checkSig(s, pk));
        
        // Verify ref token
        require(tx.inputs[this.activeInputIndex].refHashDataSummary == ref);
        
        // Build output with new owner
        bytes25 newLock = new LockingBytecodeP2PKH(newOwner);
        require(tx.outputs[0].lockingBytecode == newLock);
    }
}
```

### 2. Compile with rxdc

```bash
# Install the compiler
npm install -g rxdc

# Compile to artifact
rxdc token.rxd -o token.json

# With debug info for rxdeb
rxdc token.rxd -o token.json --debug
```

### 3. Debug with rxdeb

```bash
# Build rxdeb
cd rxdeb
./autogen.sh && ./configure --enable-rxd && make

# Debug a script
./rxdeb --artifact=token.json --tx=spending_tx.hex
```

### 4. Deploy with radiantscript SDK

```typescript
import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'radiantscript';
import artifact from './token.json';

const provider = new ElectrumNetworkProvider('mainnet');
const contract = new Contract(artifact, [ownerPkh, refHash], provider);

// Call the transfer function
const tx = await contract.functions
    .transfer(ownerPk, new SignatureTemplate(ownerPrivKey), newOwnerPkh)
    .to(recipientAddress, 1000)
    .send();
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     RadiantScript (.rxd)                         │
│                  High-level contract language                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         rxdc Compiler                            │
│            Compiles .rxd → .json artifacts                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Artifact (.json)                            │
│         Contains bytecode, ABI, source maps                      │
└─────────────────────────────────────────────────────────────────┘
                    │                   │
                    ▼                   ▼
┌───────────────────────────┐ ┌───────────────────────────────────┐
│      radiantscript        │ │            rxdeb                   │
│   JavaScript SDK          │ │     Script debugger                │
│   - Contract deployment   │ │   - Step-through execution         │
│   - Transaction building  │ │   - Stack inspection               │
│   - Network interaction   │ │   - Breakpoints                    │
└───────────────────────────┘ └───────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                        radiantjs                                 │
│              Low-level Radiant primitives                        │
│    - Keys, addresses, transactions, scripts                      │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                  radiantblockchain-constants                     │
│           Shared opcodes, limits, network params                 │
└─────────────────────────────────────────────────────────────────┘
```

## Radiant-Specific Features

### Reference Tokens

Radiant's unique reference system enables fungible and non-fungible tokens:

```solidity
// Check input has a specific ref
require(tx.inputs[0].refHashDataSummary == expectedRef);

// Push a ref to output
bytes newRef = pushInputRef(refId);

// Get ref value sums
int totalRefValue = refValueSum_utxos(refId);
```

### State Management

Contracts can maintain state across transactions:

```solidity
// Access state separator index
int stateIdx = tx.inputs[this.activeInputIndex].stateSeparatorIndex;

// Get code script (before state separator)
bytes code = tx.inputs[this.activeInputIndex].codeScriptBytecode;

// Get state script (after state separator)  
bytes state = tx.inputs[this.activeInputIndex].stateScriptBytecode;
```

### Transaction Introspection

Full access to transaction data within scripts:

```solidity
// Input introspection
int inputValue = tx.inputs[i].value;
bytes inputScript = tx.inputs[i].lockingBytecode;
bytes32 outpointHash = tx.inputs[i].outpointTransactionHash;

// Output introspection
int outputValue = tx.outputs[i].value;
bytes outputScript = tx.outputs[i].lockingBytecode;

// Transaction metadata
int version = tx.version;
int locktime = tx.locktime;
int inputCount = tx.inputs.length;
int outputCount = tx.outputs.length;
```

## Opcodes Reference

All Radiant opcodes are synchronized across the ecosystem:

| Category | Opcodes |
|----------|---------|
| **State** | `OP_STATESEPARATOR`, `OP_STATESEPARATORINDEX_UTXO`, `OP_STATESEPARATORINDEX_OUTPUT` |
| **Introspection** | `OP_INPUTINDEX`, `OP_ACTIVEBYTECODE`, `OP_TXVERSION`, `OP_UTXOVALUE`, etc. |
| **References** | `OP_PUSHINPUTREF`, `OP_REQUIREINPUTREF`, `OP_REFHASHDATASUMMARY_*`, etc. |
| **Code/State** | `OP_CODESCRIPTBYTECODE_*`, `OP_STATESCRIPTBYTECODE_*` |
| **Crypto** | `OP_SHA512_256`, `OP_HASH512_256`, `OP_CHECKDATASIG` |

## Installation

### RadiantScript + rxdc
```bash
npm install -g rxdc radiantscript @radiantscript/utils
```

### rxdeb
```bash
git clone https://github.com/Radiant-Core/rxdeb
cd rxdeb
./autogen.sh && ./configure --enable-rxd && make
```

### radiantjs
```bash
npm install @radiantblockchain/radiantjs
```

### Constants
```bash
npm install @radiantblockchain/constants
```

## Related Projects

- **[Photonic Wallet](https://github.com/photonic-wallet/photonic)** - Reference wallet using RadiantScript contracts
- **[Glyph Miner](https://github.com/glyph-miner/glyph-miner)** - Token minting with RadiantScript
- **[Radiant Core](https://github.com/radiantblockchain/radiant-node)** - Full node implementation

## Contributing

Contributions are welcome! Please see each repository's CONTRIBUTING.md for guidelines.

## License

All tools are released under the MIT License.
