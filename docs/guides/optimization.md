# Script Optimization

Tips for optimizing RadiantScript contract size and execution cost.

## Why Optimize?

- **Smaller scripts** = lower transaction fees
- **Fewer opcodes** = faster verification
- **Simpler logic** = easier auditing

## Size Optimization

### 1. Reuse Values

```radiantscript
// ❌ Redundant - computes hash twice
require(hash256(data) == expected1);
require(hash256(data) == expected2);

// ✅ Optimized - compute once, reuse
bytes32 h = hash256(data);
require(h == expected1);
require(h == expected2);
```

### 2. Use Appropriate Types

```radiantscript
// ❌ Wastes space for small values
bytes32 smallValue = 0x00000001;

// ✅ Use int for small numbers
int smallValue = 1;
```

### 3. Combine Conditions

```radiantscript
// ❌ Multiple require statements
require(a > 0);
require(a < 100);

// ✅ Combined condition
require(a > 0 && a < 100);
```

### 4. Avoid Redundant Checks

```radiantscript
// ❌ Redundant - checkSig already verifies pk format
require(pk.length == 33);
require(checkSig(s, pk));

// ✅ Just check signature
require(checkSig(s, pk));
```

## Opcode Optimization

### Check Opcount

```bash
npx rxdc MyContract.rxd --opcount
# Output: Opcode count: 45
```

### Check Size

```bash
npx rxdc MyContract.rxd --size
# Output: Bytesize: 128
```

## Common Patterns

### Efficient Multi-Output Verification

```radiantscript
// ❌ Checking each output individually
require(tx.outputs[0].value >= 1000);
require(tx.outputs[1].value >= 1000);
require(tx.outputs[2].value >= 1000);

// ✅ Use aggregate function when possible
bytes32 codeHash = hash256(this.activeBytecode);
require(tx.outputs.codeScriptValueSum(codeHash) >= 3000);
```

### Efficient Reference Tracking

```radiantscript
// ❌ Multiple reference pushes
bytes36 ref1 = pushInputRef($tokenRef);
bytes36 ref2 = pushInputRef($tokenRef); // Duplicate!

// ✅ Push once, reuse result
bytes36 ref = pushInputRef($tokenRef);
// Use ref for subsequent operations
```

## Limits to Consider

| Limit | Value | Notes |
|-------|-------|-------|
| Max script size | 10,000 bytes | Per input/output |
| Max opcode count | 201 | Legacy limit (may be higher on Radiant) |
| Max stack size | 1000 items | Combined main + alt stack |
| Max element size | 520 bytes | Single stack element |

## Optimization Checklist

- [ ] Remove redundant computations
- [ ] Use appropriate types for values
- [ ] Combine related conditions
- [ ] Use aggregate introspection functions
- [ ] Verify opcount and size are acceptable
- [ ] Profile with rxdeb for execution path

## Trade-offs

Sometimes optimization conflicts with readability or security:

```radiantscript
// More readable but slightly larger
int inputSum = tx.inputs.refValueSum($tokenRef);
int outputSum = tx.outputs.refValueSum($tokenRef);
require(inputSum == outputSum);

// Smaller but less readable
require(tx.inputs.refValueSum($tokenRef) == tx.outputs.refValueSum($tokenRef));
```

**Recommendation**: Prioritize security and readability over micro-optimizations. Only optimize aggressively if hitting limits.

## See Also

- [Language Reference](../../website/docs/language/)
- [Introspection Guide](introspection.md)
