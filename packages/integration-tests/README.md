# @radiantscript/integration-tests

Cross-repository E2E integration tests for the Radiant ecosystem.

## Overview

This package contains integration tests that verify the interoperability of various Radiant ecosystem components:

- **RadiantScript (rxdc)** - Contract compilation
- **radiantjs** - Key management, transaction building, cryptography
- **@radiantblockchain/constants** - Shared constants and validation
- **ElectrumX** - Network connectivity and blockchain queries
- **Glyph Protocol** - Token creation and management workflows

## Installation

```bash
cd packages/integration-tests
npm install
```

## Running Tests

### All Tests
```bash
npm test
```

### By Category
```bash
# Contract compilation tests
npm run test:contracts

# Wallet/radiantjs tests
npm run test:wallet

# Electrum connectivity tests
npm run test:electrum

# End-to-end workflow tests
npm run test:e2e
```

### With Coverage
```bash
npm run test:coverage
```

## Test Categories

### Contract Tests (`tests/contracts/`)
- Compiler functionality
- Artifact structure validation
- Error handling

### Wallet Tests (`tests/wallet/`)
- Key generation and derivation
- HD wallet operations
- Transaction building
- Cryptographic functions

### Electrum Tests (`tests/electrum/`)
- Server connectivity
- RPC operations
- Address queries

### E2E Tests (`tests/e2e/`)
- Token creation workflows
- Contract deployment flows
- Full transaction cycles

### Constants Tests (`tests/constants/`)
- Glyph protocol constants
- Network parameters
- Validation functions

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SKIP_NETWORK_TESTS` | Set to `true` to skip network-dependent tests | No |
| `TEST_MNEMONIC` | Mnemonic for testnet wallet (live tests only) | No |
| `TEST_PRIVATE_KEY` | Private key for testnet wallet (live tests only) | No |

### Network Configuration

Default testnet configuration is in `tests/setup.ts`:

```typescript
export const TEST_CONFIG = {
  network: 'testnet',
  electrumHost: 'electrumx-testnet.radiant4people.com',
  electrumPort: 50012,
  electrumProtocol: 'ssl',
};
```

## Writing New Tests

### Basic Structure

```typescript
describe('Feature Name', () => {
  let dependency: any;

  beforeAll(async () => {
    dependency = await import('dependency');
  });

  it('should do something', () => {
    expect(result).toBeDefined();
  });
});
```

### Network-Dependent Tests

Use the `shouldRunNetworkTests()` helper:

```typescript
import { shouldRunNetworkTests } from '../setup';

const describeIfNetwork = shouldRunNetworkTests() ? describe : describe.skip;

describeIfNetwork('Network Tests', () => {
  // These tests only run when network is available
});
```

## CI Integration

Add to your CI workflow:

```yaml
jobs:
  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
        env:
          SKIP_NETWORK_TESTS: true
```

## Test Coverage Goals

| Category | Current | Target |
|----------|---------|--------|
| Contracts | ~80% | 90% |
| Wallet | ~70% | 85% |
| Electrum | ~60% | 75% |
| E2E | ~50% | 70% |

## Contributing

1. Add tests for new features
2. Ensure all tests pass locally
3. Update this README if adding new test categories
4. Follow existing test patterns

## License

MIT
