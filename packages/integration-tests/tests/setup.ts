/**
 * Integration Test Setup
 * 
 * This file configures the test environment for cross-repo E2E tests.
 */

// Extend Jest timeout for network operations
jest.setTimeout(60000);

// Test network configuration
export const TEST_CONFIG = {
  network: 'testnet' as const,
  electrumHost: 'electrumx-testnet.radiant4people.com',
  electrumPort: 50012,
  electrumProtocol: 'ssl' as const,
};

// Skip network tests if SKIP_NETWORK_TESTS is set
export const SKIP_NETWORK_TESTS = process.env.SKIP_NETWORK_TESTS === 'true';

// Test wallet (testnet only - never use on mainnet!)
export const TEST_WALLET = {
  // This is a testnet wallet for integration testing only
  mnemonic: process.env.TEST_MNEMONIC || '',
  privateKey: process.env.TEST_PRIVATE_KEY || '',
};

// Helper to check if network tests should run
export function shouldRunNetworkTests(): boolean {
  if (SKIP_NETWORK_TESTS) {
    console.log('Skipping network tests (SKIP_NETWORK_TESTS=true)');
    return false;
  }
  if (!TEST_WALLET.mnemonic && !TEST_WALLET.privateKey) {
    console.log('Skipping network tests (no wallet credentials)');
    return false;
  }
  return true;
}

// Global setup
beforeAll(() => {
  console.log('\n🧪 Radiant Integration Tests\n');
  console.log(`Network: ${TEST_CONFIG.network}`);
  console.log(`Electrum: ${TEST_CONFIG.electrumHost}:${TEST_CONFIG.electrumPort}`);
  console.log(`Network tests: ${SKIP_NETWORK_TESTS ? 'disabled' : 'enabled'}`);
  console.log('');
});

// Global teardown
afterAll(() => {
  console.log('\n✅ Integration tests complete\n');
});
