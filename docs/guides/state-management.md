# State Management

Radiant scripts support persistent state through the state separator mechanism, enabling stateful smart contracts.

## Overview

A Radiant script can be split into two sections:
- **State Script**: Data that can change between transactions
- **Code Script**: Logic that must remain constant

The `stateSeparator` opcode (OP_STATESEPARATOR) divides these sections.

## Basic Structure

```radiantscript
pragma radiantscript ^0.9.0;

contract StatefulContract(pubkey ownerPk) 
function(int currentState) {
    // State section - variables passed as function parameters
    int newState = currentState + 1;
    
    stateSeparator;
    
    // Code section - logic below this point
    function update(sig s) {
        require(checkSig(s, ownerPk));
        
        // Verify code script is preserved in output
        bytes myCode = tx.inputs[this.activeInputIndex].codeScript;
        bytes codeHash = hash256(myCode);
        require(tx.outputs.codeScriptCount(codeHash) >= 1);
    }
}
```

## How It Works

1. **Input Script**: Contains state data followed by code
2. **State Separator**: Marks boundary between state and code
3. **Code Script**: The immutable contract logic
4. **Output**: New state + same code script

```
Input:  [state_data] [OP_STATESEPARATOR] [code_script]
Output: [new_state]  [OP_STATESEPARATOR] [code_script]
```

## Code Script Verification

To ensure contract logic can't be changed, verify the code script hash:

```radiantscript
// Get this input's code script
bytes myCode = tx.inputs[this.activeInputIndex].codeScript;

// Hash it
bytes32 codeHash = hash256(myCode);

// Ensure at least one output has the same code
require(tx.outputs.codeScriptCount(codeHash) >= 1);
```

## State Introspection Functions

| Function | Description |
|----------|-------------|
| `tx.inputs[i].codeScript` | Get code script of input i |
| `tx.inputs[i].stateScript` | Get state script of input i |
| `tx.outputs[i].codeScript` | Get code script of output i |
| `tx.outputs[i].stateScript` | Get state script of output i |
| `tx.inputs[i].stateSeparatorIndex` | Index of separator in input |
| `tx.outputs[i].stateSeparatorIndex` | Index of separator in output |
| `tx.inputs.codeScriptCount(hash)` | Count inputs with code hash |
| `tx.outputs.codeScriptCount(hash)` | Count outputs with code hash |
| `tx.inputs.codeScriptValueSum(hash)` | Sum values of inputs with code hash |
| `tx.outputs.codeScriptValueSum(hash)` | Sum values of outputs with code hash |

## Example: Counter Contract

```radiantscript
pragma radiantscript ^0.9.0;

contract Counter(pubkey ownerPk) 
function(int count) {
    // State: current count
    int newCount = count + 1;
    
    stateSeparator;
    
    function increment(sig s) {
        require(checkSig(s, ownerPk));
        
        // Preserve contract logic
        bytes myCode = tx.inputs[this.activeInputIndex].codeScript;
        require(tx.outputs.codeScriptCount(hash256(myCode)) >= 1);
        
        // newCount will be in the output's state section
    }
    
    function reset(sig s) {
        require(checkSig(s, ownerPk));
        // Reset count to 0 in state section
    }
}
```

## Example: Token with Metadata

```radiantscript
pragma radiantscript ^0.9.0;

contract TokenWithMetadata(bytes36 constant $tokenRef, pubkey ownerPk)
function(bytes metadata) {
    // State: token metadata (name, URI, etc.)
    
    stateSeparator;
    
    function transfer(sig s) {
        require(checkSig(s, ownerPk));
        pushInputRef($tokenRef);
        
        // Token logic...
    }
    
    function updateMetadata(sig s, bytes newMetadata) {
        require(checkSig(s, ownerPk));
        // newMetadata becomes the new state
    }
}
```

## Best Practices

1. **Always verify code script**: Prevent contract logic modification
2. **Minimize state size**: Larger state = higher fees
3. **Use hashes for large data**: Store data off-chain, hash on-chain
4. **Consider state migration**: Plan for contract upgrades

## See Also

- [StatefulCounter.rxd](../../examples/radiant/StatefulCounter.rxd) - Working example
- [Introspection Guide](introspection.md) - Transaction data access
