# Transaction Introspection

RadiantScript provides native access to transaction data, enabling powerful covenant patterns.

## Overview

Introspection allows contracts to:
- Verify output amounts and destinations
- Check input sources and values
- Enforce spending conditions based on transaction structure
- Implement complex multi-party protocols

## Basic Introspection

### Transaction Metadata

```radiantscript
int version = tx.version;           // Transaction version
int locktime = tx.locktime;         // Transaction locktime
int inputCount = tx.inputs.length;  // Number of inputs
int outputCount = tx.outputs.length; // Number of outputs
int myIndex = this.activeInputIndex; // Current input's index
```

### Input Data

```radiantscript
// Access input by index
int value = tx.inputs[0].value;                    // Input value in satoshis
bytes lockingBytecode = tx.inputs[0].lockingBytecode; // Previous output script
bytes32 outpointHash = tx.inputs[0].outpointTransactionHash;
int outpointIndex = tx.inputs[0].outpointIndex;
bytes unlockingBytecode = tx.inputs[0].unlockingBytecode;
int sequenceNumber = tx.inputs[0].sequenceNumber;
```

### Output Data

```radiantscript
// Access output by index
int value = tx.outputs[0].value;                   // Output value in satoshis
bytes lockingBytecode = tx.outputs[0].lockingBytecode; // Output script
```

### Current Contract

```radiantscript
bytes myBytecode = this.activeBytecode;           // This contract's script
int myIndex = this.activeInputIndex;              // This input's index
int myValue = tx.inputs[this.activeInputIndex].value; // This input's value
```

## Common Patterns

### Enforce Minimum Output

```radiantscript
function withdraw(sig s, pubkey pk) {
    require(checkSig(s, pk));
    
    // Ensure first output has at least 1000 satoshis
    require(tx.outputs[0].value >= 1000);
}
```

### Self-Replicating Contract

```radiantscript
function spend(sig s, pubkey pk) {
    require(checkSig(s, pk));
    
    // Ensure contract continues in an output
    require(tx.outputs[0].lockingBytecode == this.activeBytecode);
}
```

### Enforce Recipient

```radiantscript
function sendTo(sig s, bytes25 p2pkhScript) {
    require(checkSig(s, pk));
    
    // Verify output goes to specific P2PKH address
    require(tx.outputs[0].lockingBytecode == p2pkhScript);
}
```

### Multi-Input Verification

```radiantscript
function multiInputSpend(sig s, pubkey pk) {
    require(checkSig(s, pk));
    
    // Require at least 2 inputs
    require(tx.inputs.length >= 2);
    
    // Sum all input values
    int totalIn = tx.inputs[0].value + tx.inputs[1].value;
    
    // Ensure output doesn't exceed inputs (minus fee)
    require(tx.outputs[0].value <= totalIn - 1000);
}
```

## Radiant-Specific Introspection

### State/Code Script Access

```radiantscript
// Get state and code portions of scripts
bytes inputState = tx.inputs[0].stateScript;
bytes inputCode = tx.inputs[0].codeScript;
bytes outputState = tx.outputs[0].stateScript;
bytes outputCode = tx.outputs[0].codeScript;

// State separator index
int sepIndex = tx.inputs[0].stateSeparatorIndex;
```

### Reference Introspection

```radiantscript
// Reference data summaries
bytes refData = tx.inputs[0].refDataSummary;
bytes refHashData = tx.inputs[0].refHashDataSummary;
```

### Aggregate Functions

```radiantscript
// Sum values across inputs/outputs with same code script
bytes32 codeHash = hash256(tx.inputs[this.activeInputIndex].codeScript);
int inputSum = tx.inputs.codeScriptValueSum(codeHash);
int outputSum = tx.outputs.codeScriptValueSum(codeHash);

// Count outputs with same code script
int outputCount = tx.outputs.codeScriptCount(codeHash);
```

## Introspection Function Reference

### Input Functions
| Function | Return Type | Description |
|----------|-------------|-------------|
| `tx.inputs[i].value` | int | Value in satoshis |
| `tx.inputs[i].lockingBytecode` | bytes | Previous output script |
| `tx.inputs[i].outpointTransactionHash` | bytes32 | Previous tx hash |
| `tx.inputs[i].outpointIndex` | int | Previous output index |
| `tx.inputs[i].unlockingBytecode` | bytes | Input script |
| `tx.inputs[i].sequenceNumber` | int | Sequence number |
| `tx.inputs[i].codeScript` | bytes | Code portion (after separator) |
| `tx.inputs[i].stateScript` | bytes | State portion (before separator) |

### Output Functions
| Function | Return Type | Description |
|----------|-------------|-------------|
| `tx.outputs[i].value` | int | Value in satoshis |
| `tx.outputs[i].lockingBytecode` | bytes | Output script |
| `tx.outputs[i].codeScript` | bytes | Code portion |
| `tx.outputs[i].stateScript` | bytes | State portion |

### Aggregate Functions
| Function | Return Type | Description |
|----------|-------------|-------------|
| `tx.inputs.codeScriptValueSum(hash)` | int | Sum of input values with code hash |
| `tx.outputs.codeScriptValueSum(hash)` | int | Sum of output values with code hash |
| `tx.inputs.codeScriptCount(hash)` | int | Count of inputs with code hash |
| `tx.outputs.codeScriptCount(hash)` | int | Count of outputs with code hash |

## See Also

- [MultiSigVault.rxd](../../examples/radiant/MultiSigVault.rxd) - Introspection example
- [State Management](state-management.md) - State/code script usage
- [Reference Tokens](reference-tokens.md) - Reference introspection
