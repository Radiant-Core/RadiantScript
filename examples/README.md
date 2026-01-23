# RadiantScript Examples

This folder contains example RadiantScript contracts demonstrating core functionality and SDK usage.

## Directory Structure

```
examples/
├── radiant/           # Radiant-specific contract templates
│   ├── FungibleToken.rxd   # Fungible token with conservation
│   ├── NFT.rxd             # Non-fungible singleton token
│   ├── StatefulCounter.rxd # State management example
│   ├── MultiSigVault.rxd   # Multi-signature vault
│   └── TokenSwap.rxd       # Atomic token swap
├── p2pkh.cash         # Basic P2PKH contract
├── mecenas.cash       # Recurring payment contract
└── ...                # Other example contracts
```

## Quick Start

### Installation

```bash
cd examples
yarn install
```

### Compile a Contract

```bash
# Compile to artifact JSON
npx rxdc radiant/FungibleToken.rxd -o FungibleToken.json

# Compile with debug info for rxdeb
npx rxdc radiant/FungibleToken.rxd -o FungibleToken.json --debug
```

### Run Examples

```bash
# TypeScript examples
npx ts-node radiant/FungibleToken.ts

# JavaScript examples  
node p2pkh.js
```

## Radiant-Specific Examples

The `radiant/` subdirectory contains contracts showcasing Radiant's unique features:

| Contract | Features |
|----------|----------|
| **FungibleToken.rxd** | Reference tracking, conservation enforcement |
| **NFT.rxd** | Singleton references, uniqueness guarantees |
| **StatefulCounter.rxd** | State separator, code script verification |
| **MultiSigVault.rxd** | Native introspection, output verification |
| **TokenSwap.rxd** | Cross-reference validation, atomic swaps |

See [radiant/README.md](radiant/README.md) for detailed documentation.

## Debugging with rxdeb

All contracts can be debugged with [rxdeb](https://github.com/Radiant-Core/rxdeb):

```bash
# Compile with source maps
npx rxdc radiant/FungibleToken.rxd -o FungibleToken.json --debug

# Debug
rxdeb --artifact=FungibleToken.json --tx=<transaction_hex>
```

## Legacy CashScript Examples

The `.cash` files in this directory are legacy CashScript examples that demonstrate basic contract patterns. While they work with RadiantScript, the `radiant/` directory contains updated examples using Radiant-specific features.

## Resources

- [RadiantScript Documentation](../website/docs/)
- [Debugging Guide](../docs/guides/debugging-with-rxdeb.md)
- [Language Reference](../website/docs/language/)
- [rxdeb Repository](https://github.com/Radiant-Core/rxdeb)
