# Radiant Standard Library Examples

This directory contains standard contract templates demonstrating Radiant's unique features: reference-based tokens, native introspection, and state management.

## Contracts

### FungibleToken.rxd
Standard fungible token with conservation enforcement.
- Reference-based token tracking
- Automatic supply conservation
- Burn functionality

```bash
npx rxdc FungibleToken.rxd -o FungibleToken.json --debug
```

### NFT.rxd
Non-fungible token using singleton references.
- Guaranteed uniqueness via `pushInputRefSingleton`
- Single-owner enforcement
- Transfer with optional data

### StatefulCounter.rxd
Demonstrates state management with `stateSeparator`.
- Persistent state across transactions
- Code script verification
- State updates without logic changes

### MultiSigVault.rxd
Multi-signature vault with introspection.
- 2-of-3 multisig requirement
- Output amount verification
- Emergency recovery with timelock

### TokenSwap.rxd
Atomic swap between two token types.
- Cross-reference verification
- Price enforcement
- No counterparty risk

## Usage with rxdeb

All contracts can be compiled with debug info and debugged with rxdeb:

```bash
# Compile with source maps
npx rxdc FungibleToken.rxd -o FungibleToken.json --debug

# Debug with rxdeb
rxdeb --artifact=FungibleToken.json --tx=<transaction_hex>

# Step through with source display
rxdeb> step
rxdeb> source
rxdeb> stack
```

## Key Radiant Features Used

| Feature | Opcodes | Example Contract |
|---------|---------|------------------|
| Reference tracking | `pushInputRef`, `refValueSum` | FungibleToken |
| Singleton refs | `pushInputRefSingleton`, `refOutputCount` | NFT |
| State separator | `stateSeparator`, `codeScript` | StatefulCounter |
| Introspection | `tx.inputs[i].value`, `tx.outputs.length` | MultiSigVault |
| Cross-ref verification | Multiple `pushInputRef`, `refValueSum` | TokenSwap |

## Contract Patterns

### Token Conservation
```radiantscript
pushInputRef($tokenRef);
int inputSum = tx.inputs.refValueSum($tokenRef);
int outputSum = tx.outputs.refValueSum($tokenRef);
require(inputSum == outputSum);
```

### Singleton Enforcement
```radiantscript
pushInputRefSingleton($nftRef);
require(tx.outputs.refOutputCount($nftRef) == 1);
```

### Code Script Verification
```radiantscript
bytes myCode = tx.inputs[this.activeInputIndex].codeScript;
bytes codeHash = hash256(myCode);
require(tx.outputs.codeScriptCount(codeHash) >= 1);
```

## See Also

- [Debugging with rxdeb](../../docs/guides/debugging-with-rxdeb.md)
- [RadiantScript Language Reference](../../website/docs/language/)
- [rxdeb Repository](https://github.com/Radiant-Core/rxdeb)
