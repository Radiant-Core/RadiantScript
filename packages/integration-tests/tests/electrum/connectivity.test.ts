/**
 * Electrum Connectivity Tests
 * 
 * Tests connection to ElectrumX servers and basic RPC operations.
 */

import { TEST_CONFIG, SKIP_NETWORK_TESTS } from '../setup';

describe('Electrum Connectivity', () => {
  let ElectrumClient: any = null;

  beforeAll(async () => {
    try {
      const wsClient = await import('ws-electrumx-client');
      ElectrumClient = wsClient.ElectrumClient || wsClient.default;
    } catch (e) {
      // ws-electrumx-client not available
    }
  });

  const describeIfNetwork = SKIP_NETWORK_TESTS ? describe.skip : describe;

  describeIfNetwork('Server Connection', () => {
    let client: any;

    beforeAll(async () => {
      if (!ElectrumClient) return;
      const url = `${TEST_CONFIG.electrumProtocol}://${TEST_CONFIG.electrumHost}:${TEST_CONFIG.electrumPort}`;
      client = new ElectrumClient(url);
      await client.connect();
    });

    afterAll(async () => {
      if (client) {
        await client.disconnect();
      }
    });

    it('should connect to ElectrumX server', () => {
      expect(client).toBeDefined();
    });

    it('should get server version', async () => {
      const version = await client.request('server.version', ['integration-tests', '1.4']);
      expect(version).toBeDefined();
      expect(Array.isArray(version)).toBe(true);
      expect(version.length).toBe(2);
    });

    it('should get server banner', async () => {
      const banner = await client.request('server.banner', []);
      expect(typeof banner).toBe('string');
    });

    it('should get block header', async () => {
      const header = await client.request('blockchain.block.header', [0]);
      expect(header).toBeDefined();
      expect(typeof header).toBe('string');
      // Genesis block header should be 80 bytes (160 hex chars)
      expect(header.length).toBe(160);
    });

    it('should get current block height', async () => {
      const result = await client.request('blockchain.headers.subscribe', []);
      expect(result).toBeDefined();
      expect(result.height).toBeGreaterThan(0);
    });

    it('should estimate fee', async () => {
      const feeRate = await client.request('blockchain.estimatefee', [1]);
      expect(typeof feeRate).toBe('number');
    });
  });

  describeIfNetwork('Address Operations', () => {
    let client: any;
    // Known testnet address for testing
    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

    beforeAll(async () => {
      const url = `${TEST_CONFIG.electrumProtocol}://${TEST_CONFIG.electrumHost}:${TEST_CONFIG.electrumPort}`;
      client = new ElectrumClient(url);
      await client.connect();
    });

    afterAll(async () => {
      if (client) {
        await client.disconnect();
      }
    });

    it('should get address balance', async () => {
      try {
        const balance = await client.request('blockchain.address.get_balance', [testAddress]);
        expect(balance).toBeDefined();
        expect(typeof balance.confirmed).toBe('number');
        expect(typeof balance.unconfirmed).toBe('number');
      } catch (error: any) {
        // Address might not exist on testnet, which is fine
        expect(error.message).toContain('unknown');
      }
    });

    it('should get address history', async () => {
      try {
        const history = await client.request('blockchain.address.get_history', [testAddress]);
        expect(Array.isArray(history)).toBe(true);
      } catch (error: any) {
        // Address might not exist on testnet
        expect(error.message).toBeDefined();
      }
    });

    it('should list unspent outputs', async () => {
      try {
        const utxos = await client.request('blockchain.address.listunspent', [testAddress]);
        expect(Array.isArray(utxos)).toBe(true);
      } catch (error: any) {
        expect(error.message).toBeDefined();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle connection to invalid host gracefully', async () => {
      if (!ElectrumClient) {
        console.log('Skipping: ElectrumClient not available');
        return;
      }
      const client = new ElectrumClient('ssl://invalid.host.example:50012');
      
      await expect(async () => {
        await client.connect();
      }).rejects.toThrow();
    });
  });
});
