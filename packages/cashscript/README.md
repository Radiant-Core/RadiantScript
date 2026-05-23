# radiantscript - RadiantScript SDK

[![NPM Version](https://img.shields.io/npm/v/radiantscript.svg)](https://www.npmjs.com/package/radiantscript)
[![NPM License](https://img.shields.io/npm/l/radiantscript.svg)](https://www.npmjs.com/package/radiantscript)

RadiantScript is a high-level programming language for smart contracts on Radiant. This SDK allows you to interact with RadiantScript contracts from JavaScript/TypeScript applications.

See the [GitHub repository](https://github.com/Radiant-Core/RadiantScript) for full documentation and usage examples.

## The RadiantScript SDK
The main way to interact with RadiantScript contracts and integrate them into applications is using this SDK. It allows you to import `.json` artifact files that were compiled using the `rxdc` compiler and convert them to `Contract` objects. These objects are used to create new contract instances and interact with them.

### Installation
```bash
npm install radiantscript
```

### Usage
```ts
import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'radiantscript';
```

```js
const { Contract, ElectrumNetworkProvider, SignatureTemplate } = require('radiantscript');
```

Using the RadiantScript SDK, you can import contract artifact files, create new instances of these contracts, and interact with them:

```ts
// Import the P2PKH artifact (compiled with rxdc)
const P2PKH = require('./p2pkh-artifact.json');

// Instantiate a network provider for RadiantScript's network operations
const provider = new ElectrumNetworkProvider('mainnet');

// Create a new P2PKH contract with constructor arguments: { pkh: pkh }
const contract = new Contract(P2PKH, [pkh], provider);

// Get contract balance & output address + balance
console.log('contract address:', contract.address);
console.log('contract balance:', await contract.getBalance());

// Call the spend function with the owner's signature
const txDetails = await contract.functions
  .spend(pk, new SignatureTemplate(keypair))
  .to(contract.address, 10000)
  .send();

console.log(txDetails);
```

### Safety belts

The SDK applies a few defensive caps to surface caller bugs early. If you hit
one and need to override it, build the relevant primitive manually.

| Setting                              | Cap                                | Where                          |
|--------------------------------------|------------------------------------|--------------------------------|
| `withFeePerByte(n)`                  | `0 <= n <= 100` sat/byte           | `Transaction.withFeePerByte`   |
| `withHardcodedFee(n)`                | `0 <= n <= MAX_FEE_SATOSHIS`       | `Transaction.withHardcodedFee` |
| Output `amount`                      | `0 <= amount <= MAX_SAFE_INTEGER`  | `Transaction.validateAmount`   |
| Inputs / outputs                     | `MAX_INPUT_COUNT` / `MAX_OUTPUT_COUNT` | `Transaction.build`        |
| Encoded tx size                      | `MAX_TRANSACTION_SIZE`             | `Transaction.build`            |
| `send()` polling                     | 1200 cycles × 500 ms (≈ 10 min)    | `Transaction.send` — pass `{ signal, maxRetries }` to override |
| Electrum request                     | 30 s per request, then retry        | `ElectrumNetworkProvider`      |

These constants live in `packages/cashscript/src/constants.ts`.

### Addressing

Radiant uses **Bitcoin-style base58check** addresses. There is no `bitcoincash:` /
`bchtest:` prefix and no bech32 / cashaddr encoding. If your wallet, indexer, or
block explorer expects a cashaddr, it is not Radiant-compatible — pass the raw
base58 string instead.

| Address type | Network         | Version byte | Example prefix |
|--------------|-----------------|--------------|----------------|
| P2PKH        | mainnet         | `0x00`       | `1...`         |
| P2PKH        | testnet/regtest | `0x6f`       | `m...` / `n...`|
| P2SH         | mainnet         | `0x05`       | `3...`         |
| P2SH         | testnet/regtest | `0xc4`       | `2...`         |

The SDK helpers:

- `Contract.address` — base58 P2SH derived from the redeem script.
- `scriptToAddress(script, network)` — encode any redeem script.
- `addressToLockScript(address)` — decode P2PKH or P2SH; returns the matching
  standard locking-bytecode template (`OP_DUP OP_HASH160 <hash> OP_EQUALVERIFY
  OP_CHECKSIG` or `OP_HASH160 <hash> OP_EQUAL`).
- `validateRecipient(recipient)` — early-checks that `recipient.to` is a
  parseable base58 address before the transaction builder ever runs.
