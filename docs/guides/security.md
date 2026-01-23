# Security Considerations

Best practices for writing secure RadiantScript contracts.

## Common Vulnerabilities

### 1. Missing Signature Verification

Always verify signatures before allowing value transfers:

```radiantscript
// ❌ INSECURE - No signature check
function withdraw() {
    // Anyone can call this!
}

// ✅ SECURE - Requires signature
function withdraw(sig s, pubkey pk) {
    require(checkSig(s, pk));
}
```

### 2. Insufficient Conservation Checks

When working with tokens, always verify conservation:

```radiantscript
// ❌ INSECURE - No conservation check
function transfer(sig s) {
    require(checkSig(s, ownerPk));
    pushInputRef($tokenRef);
    // Tokens could be created out of thin air!
}

// ✅ SECURE - Conservation enforced
function transfer(sig s) {
    require(checkSig(s, ownerPk));
    pushInputRef($tokenRef);
    require(tx.inputs.refValueSum($tokenRef) == tx.outputs.refValueSum($tokenRef));
}
```

### 3. Missing Code Script Verification

For stateful contracts, verify the code script is preserved:

```radiantscript
// ✅ Verify contract logic cannot be changed
bytes myCode = tx.inputs[this.activeInputIndex].codeScript;
bytes32 codeHash = hash256(myCode);
require(tx.outputs.codeScriptCount(codeHash) >= 1);
```

### 4. Integer Overflow

RadiantScript uses arbitrary-precision integers, but be careful with bounds:

```radiantscript
// Check for reasonable values
require(amount > 0);
require(amount <= 2100000000000000); // Max supply
```

## Best Practices

### Input Validation
- Validate all function parameters
- Check array bounds before access
- Verify signatures match expected keys

### Output Verification
- Use introspection to verify output amounts
- Check output scripts match expected patterns
- Enforce minimum dust thresholds (546 satoshis)

### Reference Safety
- Use `pushInputRefSingleton` for NFTs to ensure uniqueness
- Always verify reference counts match expectations
- Check both input and output reference sums

### Testing
- Test edge cases (zero values, maximum values)
- Test with invalid signatures
- Use rxdeb to step through execution

## Auditing Checklist

- [ ] All value transfers require signature verification
- [ ] Token conservation is enforced
- [ ] Code script is verified for stateful contracts
- [ ] Input parameters are validated
- [ ] Output amounts are verified
- [ ] Reference counts are checked
- [ ] No unbounded loops or recursion
- [ ] Dust threshold is enforced

## See Also

- [Debugging with rxdeb](debugging-with-rxdeb.md)
- [Testing Guide](testing.md)
- [Reference Tokens](reference-tokens.md)
