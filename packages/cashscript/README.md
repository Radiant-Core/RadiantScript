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
