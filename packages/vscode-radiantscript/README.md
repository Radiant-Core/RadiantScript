# RadiantScript for Visual Studio Code

Language support for RadiantScript (`.rxd`) - smart contracts for the Radiant blockchain.

## Features

### Syntax Highlighting

Full syntax highlighting for RadiantScript contracts including:
- Keywords (`contract`, `function`, `require`, `if`, `else`)
- Types (`int`, `bool`, `bytes`, `pubkey`, `sig`, `bytes32`)
- Built-in functions (`checkSig`, `sha256`, `hash256`, etc.)
- Comments (line and block)
- Strings and numbers

### Code Snippets

Quick templates for common patterns:
- `contract` - Basic contract template
- `function` - Function declaration
- `ft` - Fungible Token contract
- `nft` - NFT contract
- `multisig` - Multi-signature contract
- `dmint` - dMint (proof-of-work) token
- `timelock` - TimeLock contract
- `p2pkh` - Pay-to-Public-Key-Hash

### Hover Documentation

Hover over built-in functions to see documentation:
- Signature verification: `checkSig`, `checkMultiSig`, `checkDataSig`
- Hash functions: `sha256`, `sha512_256`, `hash256`, `hash160`
- Math functions: `abs`, `min`, `max`, `within`
- Byte operations: `size`, `split`, `reverse`

### Commands

- **RadiantScript: Compile Contract** - Compile the current contract
- **RadiantScript: Deploy Contract** - Deploy to testnet or mainnet

## Installation

### From VSIX

1. Download the `.vsix` file from releases
2. Open VS Code
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
4. Type "Install from VSIX" and select the file

### From Source

```bash
cd packages/vscode-radiantscript
npm install
npm run compile
npm run package
```

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `radiantscript.compiler.path` | Path to rxdc compiler | (bundled) |
| `radiantscript.network` | Default network for deployment | `testnet` |
| `radiantscript.electrum.host` | ElectrumX server host | `electrumx.radiant4people.com` |
| `radiantscript.electrum.port` | ElectrumX server port | `50012` |

## Example Contract

```radiantscript
pragma radiant ^0.7.0;

contract P2PKH(pubkey owner) {
    function spend(sig ownerSig) {
        require(checkSig(ownerSig, owner));
    }
}
```

## Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+B` | Compile Contract |

## Requirements

- VS Code 1.85.0 or higher
- Node.js 18+ (for compilation)
- rxdc compiler (optional, for compilation)

## Related

- [RadiantScript Documentation](https://radiantscript.org)
- [Radiant Blockchain](https://radiantblockchain.org)
- [rxdeb Debugger](https://github.com/Radiant-Core/rxdeb)

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or pull request on the [RadiantScript repository](https://github.com/Radiant-Core/RadiantScript).
