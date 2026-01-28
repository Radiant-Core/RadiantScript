# @radiantscript/deploy

One-click contract deployment CLI for RadiantScript.

## Installation

```bash
npm install -g @radiantscript/deploy
```

Or use via npx:
```bash
npx @radiantscript/deploy <command>
```

## Quick Start

### 1. Create from Template

```bash
# List available templates
rxd-deploy templates

# Initialize a new project from template
rxd-deploy init FungibleToken -o my-token

# This creates:
#   my-token/FungibleToken.rxd
#   my-token/FungibleToken.config.json
```

### 2. Compile Contract

```bash
# Compile and save artifact
rxd-deploy compile my-token/FungibleToken.rxd -o my-token/FungibleToken.json
```

### 3. Deploy to Testnet

```bash
# Set your private key (or use --key flag)
export RXD_PRIVATE_KEY=your_private_key_here

# Deploy
rxd-deploy deploy my-token/FungibleToken.json --network testnet
```

## Commands

### `rxd-deploy deploy <artifact>`

Deploy a compiled contract artifact to the network.

```bash
rxd-deploy deploy contract.json \
  --network testnet \
  --key <private_key> \
  --balance 1000 \
  --args '["arg1", 123]'
```

Options:
- `-n, --network` - Network to deploy to (mainnet/testnet), default: testnet
- `-k, --key` - Private key for signing (or use RXD_PRIVATE_KEY env)
- `-m, --mnemonic` - Mnemonic phrase (or use RXD_MNEMONIC env)
- `-b, --balance` - Initial contract balance in satoshis, default: 546
- `-a, --args` - Constructor arguments as JSON array

### `rxd-deploy compile <source>`

Compile and optionally deploy a RadiantScript source file.

```bash
rxd-deploy compile MyContract.rxd \
  --output MyContract.json \
  --network testnet \
  --key <private_key>
```

Options:
- `-n, --network` - Network to deploy to
- `-k, --key` - Private key (if provided, will also deploy)
- `-m, --mnemonic` - Mnemonic phrase
- `-o, --output` - Save compiled artifact to file
- `-b, --balance` - Initial contract balance

### `rxd-deploy templates`

List available contract templates.

```bash
rxd-deploy templates
rxd-deploy templates --category token
```

### `rxd-deploy init <template>`

Initialize a new project from a template.

```bash
rxd-deploy init NFT -o my-nft -n MyNFT
```

Options:
- `-o, --output` - Output directory
- `-n, --name` - Contract name

### `rxd-deploy balance <address>`

Check the balance of an address.

```bash
rxd-deploy balance 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa --network mainnet
```

### `rxd-deploy fee`

Estimate current network fee rate.

```bash
rxd-deploy fee --network mainnet --blocks 1
```

## Available Templates

| Template | Category | Description |
|----------|----------|-------------|
| **FungibleToken** | token | Standard fungible token with mint and transfer |
| **NFT** | nft | Non-fungible token with singleton reference |
| **MultiSigVault** | utility | M-of-N multi-signature vault |
| **dMintToken** | token | Decentralized minting with proof-of-work |
| **TimeLock** | utility | Time-locked funds contract |

## Environment Variables

- `RXD_PRIVATE_KEY` - Private key for signing transactions
- `RXD_MNEMONIC` - Mnemonic phrase for HD wallet derivation

## Programmatic Usage

```typescript
import { DeploymentManager, getTemplate } from '@radiantscript/deploy';

async function main() {
  const manager = new DeploymentManager('testnet');
  await manager.connect();

  const result = await manager.compileAndDeploy(
    { privateKey: 'your_private_key' },
    `
    pragma radiant ^0.7.0;
    contract Hello() {
      function greet() { require(true); }
    }
    `
  );

  console.log('Deployed:', result.txid);
  await manager.disconnect();
}
```

## Security

- **Never commit private keys** to version control
- Use environment variables for sensitive data
- Always test on testnet before mainnet deployment
- Verify contract source code before deployment

## License

MIT
