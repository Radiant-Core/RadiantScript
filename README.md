# RadiantScript

## ⚠️ RadiantScript is alpha software and likely to have bugs. Mainnet use is not recommended. ⚠️
This project is in development. Language grammar is likely to change. Any contracts compiled with `rxdc` must be well tested to ensure compiled code behaves as expected. Please report any bugs.

RadiantScript is a fork of CashScript with support for Radiant opcodes. It is a high-level language that allows you to write Radiant smart contracts in a straightforward and familiar way.

## The RadiantScript Compiler
RadiantScript features a compiler as a standalone command line tool, called `rxdc`. It compiles `.rxd` files into `.json` artifact files usable by rad-scryptlib. The `rxdc` package can also be imported inside JavaScript files to compile `.rxd` files without using the command line tool.

### Installation
```bash
yarn
```

`rxdc` will be installed to `node_modules/.bin/rxdc`. This can be executed with `npx`.

### Usage
```bash
Usage: npx rxdc [options] [source_file]

Options:
  -V, --version        Output the version number.
  -o, --output <path>  Specify a file to output the generated artifact.
  -h, --hex            Compile the contract to hex format rather than a full artifact.
  -A, --asm            Compile the contract to ASM format rather than a full artifact.
  -c, --opcount        Display the number of opcodes in the compiled bytecode.
  -s, --size           Display the size in bytes of the compiled bytecode.
  -d, --debug          Include source code and source map for debugging with rxdeb.
  -?, --help           Display help
```

### Debugging with rxdeb

RadiantScript supports source-level debugging with [rxdeb](https://github.com/Radiant-Core/rxdeb):

```bash
# Compile with debug info
npx rxdc MyContract.rxd -o MyContract.json --debug

# Debug with rxdeb
rxdeb --artifact=MyContract.json --tx=<transaction_hex>

# Step through source code
rxdeb> step
rxdeb> source
rxdeb> stack
```

See [Debugging Guide](docs/guides/debugging-with-rxdeb.md) for more details.

## Example fungible token contract

```solidity
// Contract definition with scriptPubKey parameters
contract FungibleToken (bytes36 REF, bytes20 PKH)
// Function with first scriptSig parameters. These parameters are available to the state script and code script
function (sig s, pubkey pk) {
    // Contract parameters are always placed inline in the script. They should only be used once.
    // This gives the developer control over where they are placed in the compiled script
    // With parameters placed inline the below results in a standard P2PKH script
    require(hash160(pk) == PKH);
    require(checkSig(s, pk));

    stateSeparator;

    // codeScript below, consisting of one or more functions
    bytes36 ref = pushInputRef(REF);

    // Get code script hash for this input
    bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
    // Ensure reference isn't used in any output that doesn't contain this code script
    require(tx.outputs.codeScriptCount(csh) == tx.outputs.refOutputCount(ref));
    // Input sum must equal output sum
    require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
}
```

## Multiple functions

A contract can have multiple functions by returning an object. For example:

```solidity
contract MultipleFunctions()
function () {
  // Code can be placed here

  // Return functions
  return {
    hello() {
      require(true);
    },
    world() {
      require(true);
    }
  }
}
```

## Standard Library Templates

The `examples/radiant/` directory contains ready-to-use contract templates:

| Contract | Description |
|----------|-------------|
| **FungibleToken.rxd** | Standard fungible token with conservation enforcement |
| **NFT.rxd** | Non-fungible token using singleton references |
| **StatefulCounter.rxd** | State management with stateSeparator |
| **MultiSigVault.rxd** | 2-of-3 multisig with introspection |
| **TokenSwap.rxd** | Atomic swap between token types |

See [examples/radiant/README.md](examples/radiant/README.md) for usage details.

## Radiant-Specific Features

RadiantScript supports all Radiant opcodes including:

- **Reference Operations**: `pushInputRef`, `requireInputRef`, `pushInputRefSingleton`
- **Introspection**: `tx.inputs[i].value`, `tx.outputs[i].lockingBytecode`, etc.
- **State Management**: `stateSeparator`, `codeScript`, `stateScript`
- **Token Tracking**: `refValueSum`, `refOutputCount`, `codeScriptCount`
- **SHA512/256**: `sha512_256`, `hash512_256`

## Tests

Run tests:
```
yarn test
```

Please see tests for example contracts including usage of Radiant specific op codes.

## Related Projects

- [rxdeb](https://github.com/Radiant-Core/rxdeb) - Radiant Script Debugger
- [Radiant Core](https://github.com/Radiant-Core/radiant-node) - Radiant Node
- [radiantjs](https://github.com/Radiant-Core/radiantjs) - JavaScript library
