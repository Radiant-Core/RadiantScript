# Debugging RadiantScript Contracts with rxdeb

This guide explains how to use the RadiantScript compiler's debug mode to enable source-level debugging with `rxdeb`, the Radiant Script Debugger.

## Overview

When you compile a RadiantScript contract with the `--debug` flag, the compiler includes:
- **source**: The original `.rxd` source code
- **sourceMap**: A mapping from bytecode offsets to source locations (line, column, function name)

This allows `rxdeb` to show you the original RadiantScript source code as you step through script execution.

## Compiling with Debug Information

```bash
# Compile with source map for debugging
npx rxdc MyContract.rxd -o MyContract.json --debug

# Or output to stdout with debug info
npx rxdc MyContract.rxd --debug
```

## Artifact with Source Map

When compiled with `--debug`, the artifact includes additional fields:

```json
{
  "version": 9,
  "compilerVersion": "rxdc 0.9.0",
  "contract": "FungibleToken",
  "abi": [...],
  "asm": "...",
  "hex": "...",
  "source": "pragma radiantscript ^0.9.0;\n\ncontract FungibleToken(...) {\n  ...\n}",
  "sourceMap": {
    "0": { "line": 5, "column": 4, "functionName": "transfer" },
    "3": { "line": 6, "column": 8, "functionName": "transfer" },
    ...
  }
}
```

## Using with rxdeb

### Basic Debugging

```bash
# Debug a compiled artifact with a transaction
rxdeb --artifact=MyContract.json --tx=<transaction_hex>

# Step through execution with source display
rxdeb> step
   Line 5: require(checkSig(sig, pubkey));
   Stack: [<sig>, <pubkey>]

rxdeb> source
   3:   function transfer(sig s, pubkey pk) {
   4:     bytes ref = pushInputRef(0x...);
>> 5:     require(checkSig(s, pk));
   6:   }
```

### With Live UTXO Context (Electrum)

```bash
# Connect to Electrum server for live UTXO data
rxdeb --artifact=MyContract.json \
      --electrum=electrum.radiant.ovh:50002 \
      --txid=<txid> --vin=0
```

## Source Map Structure

The `sourceMap` object maps bytecode instruction offsets to source locations:

```typescript
interface SourceMapEntry {
  line: number;       // 1-indexed line number
  column: number;     // 0-indexed column number  
  file?: string;      // Optional source file name
  functionName?: string; // Function name if inside a function
}

interface SourceMap {
  [bytecodeOffset: number]: SourceMapEntry;
}
```

## Example: FungibleToken Contract

```radiantscript
pragma radiantscript ^0.9.0;

contract FungibleToken(bytes36 constant $tokenRef) {
    function transfer(sig s, pubkey pk) {
        // Push the token reference
        pushInputRef($tokenRef);
        
        // Verify signature
        require(checkSig(s, pk));
        
        // Check token conservation
        int inputSum = tx.inputs.refValueSum($tokenRef);
        int outputSum = tx.outputs.refValueSum($tokenRef);
        require(inputSum == outputSum);
    }
}
```

Compile and debug:

```bash
# Compile with debug info
npx rxdc FungibleToken.rxd -o FungibleToken.json --debug

# Debug with rxdeb
rxdeb --artifact=FungibleToken.json --tx=<hex>
```

## Limitations

- Source maps are generated for key AST nodes (literals, function calls, requires)
- Optimized bytecode may have slightly offset source positions
- Inline parameters are not tracked in source maps

## See Also

- [rxdeb Documentation](https://github.com/Radiant-Core/rxdeb)
- [RadiantScript Language Reference](../language/README.md)
- [Radiant Core Opcodes](../basics/opcodes.md)
