---
title: Contract Instantiation
---

Before interacting with smart contracts on the Radiant network, the RadiantScript SDK needs to instantiate a `Contract` object. This is done by providing the contract's information and constructor arguments. After this instantiation, the RadiantScript SDK can interact with Radiant contracts.

## Contract class
The `Contract` class is used to represent a RadiantScript contract in a JavaScript object. These objects can be used to retrieve information such as the contract's address and balance. They can be used to interact with the contract by calling the contract's functions.

### Constructor
```ts
new Contract(
  artifact: Artifact,
  constructorArgs: Argument[],
  provider?: NetworkProvider,
)
```

A RadiantScript contract can be instantiated by providing an `Artifact` object, a list of constructor arguments, and optionally a `NetworkProvider`.

An `Artifact` object is the result of compiling a RadiantScript contract. See the [Language Documentation](/docs/language/artifacts) for more information on Artifacts. Compilation can be done using the standalone [`rxdc` CLI](/docs/basics/cli) or programmatically with the `rxdc` NPM package (see [RadiantScript Compiler](#radiantscript-compiler)).

A `NetworkProvider` is used to manage network operations for the RadiantScript contract. By default, a mainnet `ElectrumNetworkProvider` is used, but alternative network providers can be used. See the section on [NetworkProvider](#networkprovider) below.

#### Example
```ts
const { Contract, ElectrumNetworkProvider } = require('radiantscript');
const { compileFile } = require('rxdc');

// Import an artifact JSON file that was compiled earlier
const P2PKH = require('./p2pkh.json');

// Or compile a contract file
const P2PKH = compileFile(path.join(__dirname, 'p2pkh.rxd'));

const provider = new ElectrumNetworkProvider('testnet');
const contract = new Contract(P2PKH, [alicePkh], provider);
```

### address
```ts
contract.address: string
```

A contract's address can be retrieved through the `address` member field.

#### Example
```ts
console.log(contract.address)
```

### opcount
```ts
contract.opcount: number
```

The number of opcodes in the contract's bytecode can be retrieved through the `opcount` member field. This is useful to ensure that the contract is not too big, since Radiant smart contracts can contain a maximum of 201 opcodes.

#### Example
```ts
assert(contract.opcount <= 201)
```

### bytesize
```ts
contract.bytesize: number
```

The size of the contract's bytecode in bytes can be retrieved through the `bytesize` member field. This is useful to ensure that the contract is not too big, since Radiant smart contracts can be 520 bytes at most.

#### Example
```ts
console.log(contract.bytesize)
```

### getRedeemScriptHex()
```ts
contract.getRedeemScriptHex: string
```

Returns the contract's redeem script encoded as a hex string.

#### Example
```ts
console.log(contract.getRedeemScriptHex())
```

### getBalance()
```ts
async contract.getBalance(): Promise<number>
```

Returns the total balance of the contract in satoshis. Both confirmed and unconfirmed balance is included in this figure.

#### Example
```ts
const contractBalance = await contract.getBalance()
```

### GetUtxos()
```ts
async contract.getUtxos(): Promise<Utxo[]>
```

Returns all UTXOs that can be spent by the contract. Both confirmed and unconfirmed UTXOs are included.

#### Example
```ts
const utxos = await contract.getUtxos()
```

### Contract functions
```ts
contract.functions.<functionName>(...args: Argument[]): Transaction
```

The main way to use smart contracts once they have been instantiated is through the functions defined in the RadiantScript source code. These functions can be found by their name under `functions` member field of a contract object. To call these functions, the parameters need to match ones defined in the RadiantScript code.

These contract functions return an incomplete `Transaction` object, which needs to be completed by providing outputs of the transaction. More information about sending transactions is found on the [*Sending Transactions*](/docs/sdk/transactions) page.

#### Example
```ts
import { alice } from './somewhere';

const tx = await contract.functions
  .transfer(new SignatureTemplate(alice))
  .to('radiant:qrhea03074073ff3zv9whh0nggxc7k03ssh8jv9mkx', 10000)
  .send()
```

## SignatureTemplate
```ts
new SignatureTemplate(signer: Keypair | Uint8Array | string, hashtype?: HashType)
```

You may notice the `SignatureTemplate` object in the example above. When a contract function has a `sig` parameter, it requires a cryptographic signature over the spending transaction. But to generate this signature, the transaction needs to be built first, which is not yet the case when a contract function is first called.

So in the place of a signature, a `SignatureTemplate` can be passed, which will automatically generate the correct signature using the `signer` parameter. This signer can be any representation of a private key, including [BITBOX/RXDJS' `ECPair`][ecpair], [bitcore-lib-cash' `PrivateKey`][privatekey], [WIF strings][wif], or raw private key buffers. This ensures that any RXD library can be used.

#### Example
```ts
const wif = 'L4vmKsStbQaCvaKPnCzdRArZgdAxTqVx8vjMGLW5nHtWdRguiRi1';
const sig = new SignatureTemplate(wif, HashType.SIGHASH_ALL);
```

## NetworkProvider
The RadiantScript SDK needs to connect to the RXD network to perform certain operations, like retrieving the contract's balance, or sending transactions. All network functionality that the RadiantScript SDK needs is encapsulated in a network provider. This allows different network providers to be used and makes it easy to swap out dependencies.

### ElectrumNetworkProvider
```ts
new ElectrumNetworkProvider(network?: Network, electrum?: ElectrumCluster)
```

The ElectrumNetworkProvider uses [electrum-cash][electrum-cash] to connect to the RXD network. This is the recommended provider for most use cases and is used as the default when no other provider is provided. Both `network` and `electrum` parameters are optional, and they default to mainnet and a 2-of-3 ElectrumCluster with a number of reliable electrum servers.

#### Example
```ts
const provider = new ElectrumProvider('testnet');
```

### RpcNetworkProvider
```ts
new BitcoinRpcNetworkProvider(network: Network, url: string, options?: any)
```

The BitcoinRpcNetworkProvider uses a direct connection to a RXD node. Note that a regular node does not have indexing, so any address of interest (e.g. the contract address) need to be registered by the node *before* sending any funds to those addresses. Because of this it is recommended to use a different network provider unless you have a specific reason to use the RPC provider.

#### Example
```js
const provider = new BitcoinRpcNetworkProvider('mainnet', 'http://localhost:8332');
```

### Custom NetworkProviders
A big strength of the NetworkProvider setup is that it allows you to implement custom providers. So if new RXD libraries are created in the future, it is simple to use them with RadiantScript. This also potentially enables the RadiantScript SDK to be used with other (partially) compatible networks, such as BTC or BSV.

#### NetworkProvider interface
```ts
interface NetworkProvider {
  /**
   * Variable indicating the network that this provider connects to.
   */
  network: Network;

  /**
   * Retrieve all UTXOs (confirmed and unconfirmed) for a given address.
   * @param address The CashAddress for which we wish to retrieve UTXOs.
   * @returns List of UTXOs spendable by the provided address.
   */
  getUtxos(address: string): Promise<Utxo[]>;

  /**
   * @returns The current block height.
   */
  getBlockHeight(): Promise<number>;

  /**
   * Retrieve the Hex transaction details for a given transaction ID.
   * @param txid Hex transaction ID.
   * @throws {Error} If the transaction does not exist
   * @returns The full hex transaction for the provided transaction ID.
   */
  getRawTransaction(txid: string): Promise<string>;

  /**
   * Broadcast a raw hex transaction to the network.
   * @param txHex The raw transaction hex to be broadcast.
   * @throws {Error} If the transaction was not accepted by the network.
   * @returns The transaction ID corresponding to the broadcast transaction.
   */
  sendRawTransaction(txHex: string): Promise<string>;
}

type Network = 'mainnet' | 'testnet' | 'staging' | 'regtest';

interface Utxo {
  txid: string;
  vout: number;
  satoshis: number;
}
```

## RadiantScript Compiler
Generally RadiantScript contracts are compiled to an Artifact JSON file using the CLI compiler. As an alternative to this, RadiantScript contracts can be compiled from within JavaScript apps using the `rxdc` package. This package needs to be installed separately and exports two compilation functions.

```bash
npm install rxdc
```

### compileFile()
```ts
compileFile(sourceFile: string): Artifact
```

Compiles a RadiantScript contract from a source file. This is the recommended compile method if you're using Node.js and you have a source file available.

#### Example
```ts
const P2PKH = compileFile(path.join(__dirname, 'p2pkh.rxd'));
```

### compileString()
```ts
compileString(sourceCode: string): Artifact
```

Compiles a RadiantScript contract from a source code string. This is the recommended compile method if you're building a webapp, because `compileFile()` only works from a Node.js context. This is also the recommended method if no source file is locally available (e.g. the source code is retrieved with a REST API).

```ts
const baseUrl = 'https://raw.githubusercontent.com/Radiant-Core/RadiantScript'
const result = await fetch(`${baseUrl}/master/examples/p2pkh.rxd`);
const source = await result.text();

const P2PKH = compileString(source);
```

[fetch-api]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
[bip68]: https://github.com/bitcoin/bips/blob/master/bip-0068.mediawiki
[wif]: https://en.bitcoin.it/wiki/Wallet_import_format
[electrum-cash]: https://www.npmjs.com/package/electrum-cash
