---
title: Getting Started
---

## Installing the RadiantScript Compiler

The command line RadiantScript compiler `rxdc` can be installed from the repository.

```bash
git clone https://github.com/Radiant-Core/RadiantScript.git
cd RadiantScript
yarn install
```

The compiler will be available at `node_modules/.bin/rxdc` or via `npx rxdc`.

## Writing Your First Smart Contract

RadiantScript contracts use the `.rxd` file extension. Here's a simple example:

```solidity
pragma radiantscript ^0.9.0;

contract TransferWithTimeout(pubkey sender, pubkey recipient, int timeout) {
    // Allow the recipient to claim their received money
    function transfer(sig recipientSig) {
        require(checkSig(recipientSig, recipient));
    }

    // Allow the sender to reclaim their sent money after the timeout is reached
    function timeout(sig senderSig) {
        require(checkSig(senderSig, sender));
        require(tx.time >= timeout);
    }
}
```

:::tip
Read more about the RadiantScript language syntax in the [Language Description](/docs/language/contracts).
:::

## Compiling Contracts

```bash
# Compile to artifact JSON
npx rxdc ./transfer_with_timeout.rxd -o ./transfer_with_timeout.json

# Compile with debug info for rxdeb
npx rxdc ./transfer_with_timeout.rxd -o ./transfer_with_timeout.json --debug
```

## Radiant-Specific Features

RadiantScript supports powerful Radiant-specific features:

```solidity
pragma radiantscript ^0.9.0;

contract FungibleToken(bytes36 constant $tokenRef, pubkey ownerPk) {
    function transfer(sig s) {
        require(checkSig(s, ownerPk));
        
        // Track token reference
        pushInputRef($tokenRef);
        
        // Enforce conservation: input tokens == output tokens
        int inputSum = tx.inputs.refValueSum($tokenRef);
        int outputSum = tx.outputs.refValueSum($tokenRef);
        require(inputSum == outputSum);
    }
}
```

See the [standard library templates](https://github.com/Radiant-Core/RadiantScript/tree/main/examples/radiant) for more examples.

## Debugging with rxdeb

RadiantScript integrates with [rxdeb](https://github.com/Radiant-Core/rxdeb) for source-level debugging:

```bash
# Compile with debug info
npx rxdc MyContract.rxd -o MyContract.json --debug

# Debug with rxdeb
rxdeb --artifact=MyContract.json --tx=<transaction_hex>
```

:::tip
Read more about debugging in the [rxdeb integration guide](/docs/guides/debugging).
:::
