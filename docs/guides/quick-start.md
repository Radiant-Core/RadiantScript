# Quick Start Guide

Get started with RadiantScript in minutes.

## Prerequisites

- Node.js 16+ and Yarn
- Basic understanding of UTXO-based blockchains

## Installation

```bash
# Clone the repository
git clone https://github.com/Radiant-Core/RadiantScript.git
cd RadiantScript

# Install dependencies
yarn install

# The compiler is now available
npx rxdc --version
```

## Your First Contract

Create a file `HelloWorld.rxd`:

```radiantscript
pragma radiantscript ^0.9.0;

// Simple P2PKH-style contract
contract HelloWorld(bytes20 pkh) {
    function spend(pubkey pk, sig s) {
        require(hash160(pk) == pkh);
        require(checkSig(s, pk));
    }
}
```

## Compile the Contract

```bash
# Compile to artifact JSON
npx rxdc HelloWorld.rxd -o HelloWorld.json

# View ASM output
npx rxdc HelloWorld.rxd --asm

# Compile with debug info for rxdeb
npx rxdc HelloWorld.rxd -o HelloWorld.json --debug
```

## Understanding the Artifact

The compiled artifact contains:

```json
{
  "version": 9,
  "compilerVersion": "rxdc 0.9.0",
  "contract": "HelloWorld",
  "abi": [
    {
      "name": "spend",
      "inputs": [
        { "name": "pk", "type": "pubkey" },
        { "name": "s", "type": "sig" }
      ]
    }
  ],
  "asm": "OP_DUP OP_HASH160 <pkh> OP_EQUALVERIFY OP_CHECKSIG",
  "hex": "76a914...88ac"
}
```

## Using with SDK

```typescript
import { Contract, ElectrumNetworkProvider } from 'cashscript';
import artifact from './HelloWorld.json';

const provider = new ElectrumNetworkProvider('mainnet');
const pkh = Buffer.from('...', 'hex'); // 20-byte public key hash

const contract = new Contract(artifact, [pkh], { provider });
console.log('Contract address:', contract.address);
```

## Next Steps

- [Language Basics](../../website/docs/language/) - Learn RadiantScript syntax
- [Reference Tokens](reference-tokens.md) - Build fungible tokens
- [Debugging](debugging-with-rxdeb.md) - Debug with rxdeb
- [Examples](../../examples/radiant/) - Study real contracts
