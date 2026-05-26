# Fix for Stateful Contract Transfers (Wave Name / Domain Transfer Issue)

## Problem Summary

When transferring a stateful contract (like a wave name or domain) to a new owner, the transaction was failing with:

```
mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation)
```

**Root Cause**: The transfer output was not including the new owner's identity (pkh) in the state section of the UTXO. When the new owner tried to spend, the contract verified `hash160(senderPk) == embeddedPkh`, but the embedded pkh was either empty or still contained the old owner's identity.

## The Fix

### Before (Broken)

```typescript
// WRONG: Using address string creates P2SH output WITHOUT state section
await contract.functions
  .transfer(currentOwnerPk, new SignatureTemplate(currentOwnerPrivKey))
  .to(contract.address, amount)  // This is just P2SH - no state!
  .send();
```

### After (Fixed)

```typescript
import { buildStatefulOutput, hash160 } from 'radiantscript';
import { hexToBin } from '@bitauth/libauth';

// 1. Compute new owner's pkh
const newOwnerPkh = hash160(newOwnerPubKey);

// 2. Build stateful output with new owner's pkh in state section
const codeScript = hexToBin(contract.getRedeemScriptHex());
const statefulOutput = buildStatefulOutput(newOwnerPkh, codeScript);

// 3. Transfer using RAW LOCKING BYTECODE (not address string)
await contract.functions
  .transfer(currentOwnerPk, new SignatureTemplate(currentOwnerPrivKey))
  .to(statefulOutput, amount)  // Uint8Array with proper state!
  .send();
```

## SDK Enhancement

The `Contract` class now includes a `buildStatefulOutput()` helper method:

```typescript
// Simpler version using the new helper
const newOwnerPkh = hash160(newOwnerPubKey);
const statefulOutput = contract.buildStatefulOutput(newOwnerPkh);

await contract.functions
  .transfer(currentOwnerPk, new SignatureTemplate(currentOwnerPrivKey))
  .to(statefulOutput, amount)
  .send();
```

## How It Works

Stateful contract UTXOs have this structure:

```
<push:stateData> OP_STATESEPARATOR <codeScript>
```

Where:
- `stateData` = 20-byte pkh of the current owner
- `OP_STATESEPARATOR` (0xbd) = separator byte
- `codeScript` = the compiled contract bytecode

When spending, the contract reads `tx.inputs[i].stateScript` to verify ownership. For the new owner to be able to sign, the output of the transfer transaction MUST have THEIR pkh in the state section.

## Full Example

See `/examples/radiant/FungibleTokenTransferFix.ts` for a complete working example.

## Photonic Wallet Integration

For Photonic Wallet, when changing the Target address (transferring a wave name):

1. Get the new owner's public key
2. Compute their pkh: `hash160(newOwnerPubKey)`
3. Call `contract.buildStatefulOutput(newOwnerPkh)` to create the proper output
4. Use this output in the `.to()` call instead of an address string

This ensures the new owner can successfully sign future transactions.
