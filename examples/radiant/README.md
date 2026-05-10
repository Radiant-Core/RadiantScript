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

### Glyph v2 reference contracts
Production-style templates implementing the Glyph v2 Token Standard
(REP-3001) and related protocols:

- `GlyphV2FT.rxd` — fungible token (transfer, burn) with value-sum conservation
- `GlyphV2NFT.rxd` — NFT with optional on-chain royalty enforcement
- `GlyphV2NFTSoulbound.rxd` — non-transferable NFT (burn-only)
- `GlyphV2Container.rxd` — collection / container token (REP-3013)
- `GlyphV2Authority.rxd` — delegable authority token (REP-3015)

### Induction proof patterns
- `InductionNFT.rxd` — Method 1 (reference + code-continuity induction)
- `InductionV3NFT.rxd` — Method 2 (TxId v3 preimage induction, 112-byte split)
- `ValueConservationToken.rxd` — fee-aware conservation using `tx.state.{inputSum,outputSum}`

### Drafts (`*.rxd.draft`)

The following files describe contracts whose design depends on compiler
features that are not yet implemented (array parameters, `tx.state.{height,
target,lastTime}`, the `blake3()` / `k12()` global builtins, dynamic
`pushInputRef(runtimeRef)`). They are kept as design references and are
intentionally **not** compiled by CI:

- `DmintV2Blake3.rxd.draft` — V2 dMint with on-chain BLAKE3 PoW + ASERT-lite DAA
- `DmintV2K12.rxd.draft` — V2 dMint with on-chain K12 PoW + ASERT-lite DAA
- `GlyphV2FTMint.rxd.draft` — Glyph v2 dMint reward contract

These are tracked by the V2 Hard Fork upgrade plan; once the compiler grows the
required globals/types these will be promoted back to `.rxd`.

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
