# Testing RadiantScript Contracts

Guidelines for testing your RadiantScript contracts.

## Unit Testing with Jest

The RadiantScript SDK supports testing with Jest:

```typescript
import { Contract, MockNetworkProvider } from 'cashscript';
import { compileFile } from 'cashc';

describe('FungibleToken', () => {
  let contract: Contract;
  let provider: MockNetworkProvider;

  beforeEach(() => {
    const artifact = compileFile('./FungibleToken.rxd');
    provider = new MockNetworkProvider();
    contract = new Contract(artifact, [tokenRef, ownerPk], { provider });
  });

  it('should transfer tokens with valid signature', async () => {
    // Setup mock UTXOs
    provider.addUtxo(contract.address, {
      txid: '...',
      vout: 0,
      satoshis: 1000,
    });

    // Execute transfer
    const tx = await contract.functions
      .transfer(new SignatureTemplate(ownerPrivKey))
      .to(recipientAddress, 1000)
      .send();

    expect(tx.txid).toBeDefined();
  });

  it('should reject transfer without valid signature', async () => {
    await expect(
      contract.functions
        .transfer(new SignatureTemplate(wrongKey))
        .to(recipientAddress, 1000)
        .send()
    ).rejects.toThrow();
  });
});
```

## Integration Testing with rxdeb

Use rxdeb for step-by-step debugging:

```bash
# Compile with debug info
npx rxdc FungibleToken.rxd -o FungibleToken.json --debug

# Test script execution
rxdeb --artifact=FungibleToken.json --tx=<raw_tx_hex>
```

### rxdeb Commands

```
rxdeb> step          # Execute next opcode
rxdeb> continue      # Run to completion
rxdeb> stack         # Show current stack
rxdeb> source        # Show source location
rxdeb> refs          # Show reference tracking
rxdeb> context       # Show transaction context
```

## Test Patterns

### Testing Token Conservation

```typescript
it('should enforce token conservation', async () => {
  const inputSum = 1000;
  const outputSum = 1001; // More than input!

  await expect(
    contract.functions.transfer(sig)
      .to(address, outputSum)
      .send()
  ).rejects.toThrow('Conservation violated');
});
```

### Testing Singleton NFTs

```typescript
it('should reject duplicate NFT outputs', async () => {
  await expect(
    contract.functions.transfer(sig)
      .to(address1, 546) // First output with NFT
      .to(address2, 546) // Second output with same NFT ref!
      .send()
  ).rejects.toThrow('Singleton violation');
});
```

### Testing State Updates

```typescript
it('should preserve code script in output', async () => {
  const tx = await contract.functions.increment(sig).send();
  
  // Verify output has same code script
  const outputScript = tx.outputs[0].lockingBytecode;
  expect(outputScript).toContain(codeScriptHash);
});
```

## Testnet Deployment

For integration testing on testnet:

```typescript
const provider = new ElectrumNetworkProvider('testnet');
const contract = new Contract(artifact, params, { provider });

// Fund contract from testnet faucet
// Execute transactions
// Verify on block explorer
```

## Coverage Checklist

- [ ] Happy path (valid inputs, expected outputs)
- [ ] Invalid signatures
- [ ] Missing required inputs
- [ ] Conservation violations
- [ ] Singleton violations
- [ ] Boundary conditions (zero, max values)
- [ ] Timelock conditions
- [ ] Multi-function contracts (all functions)

## See Also

- [Debugging with rxdeb](debugging-with-rxdeb.md)
- [Security Considerations](security.md)
