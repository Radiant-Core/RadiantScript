import { binToHex } from '@bitauth/libauth';
import { sha256 } from '@radiantscript/utils';
import {
  ElectrumCluster,
  ElectrumTransport,
  ClusterOrder,
  RequestResponse,
} from 'electrum-cash';
import { Utxo, Network } from '../interfaces.js';
import NetworkProvider from './NetworkProvider.js';
import { addressToLockScript, validateUtxo } from '../utils.js';

/**
 * ElectrumNetworkProvider - Network provider for connecting to Electrum/RXinDexer servers
 *
 * SECURITY NOTES:
 * - Always use WSS (WebSocket Secure) or SSL/TLS for production connections to prevent MITM attacks
 * - TCP connections (port 50010) are unencrypted and should only be used for localhost/regtest
 * - The mainnet default uses WSS on port 443 for encrypted communication
 * - For production deployments, consider running your own RXinDexer node with proper TLS certificates
 * - Certificate pinning is not implemented - verify server certificates through your infrastructure
 */
export default class ElectrumNetworkProvider implements NetworkProvider {
  private electrum: ElectrumCluster;
  private concurrentRequests: number = 0;

  // Rate limiting and retry configuration
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_RETRY_DELAY_MS = 1000;
  private static readonly MAX_RETRY_DELAY_MS = 10000;
  private static readonly REQUEST_TIMEOUT_MS = 30000;
  private static readonly MAX_CONCURRENT_REQUESTS = 10;

  private requestTimestamps: number[] = [];
  private static readonly RATE_LIMIT_WINDOW_MS = 1000;
  private static readonly MAX_REQUESTS_PER_WINDOW = 30;

  private circuitBreakerFailures = 0;
  private circuitBreakerLastFailure = 0;
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private static readonly CIRCUIT_BREAKER_RESET_MS = 60000;

  /**
   * Creates a new ElectrumNetworkProvider
   *
   * @param network - The network to connect to ('mainnet', 'testnet', 'regtest')
   * @param electrum - Optional custom ElectrumCluster for advanced configuration
   * @param manualConnectionManagement - Whether to manually manage connections
   *
   * SECURITY: When providing a custom electrum cluster, ensure you use encrypted
   * connections (WSS/SSL) for any non-localhost production use.
   */
  constructor(
    public network: Network = Network.MAINNET,
    electrum?: ElectrumCluster,
    private manualConnectionManagement?: boolean,
  ) {
    // If a custom Electrum Cluster is passed, we use it instead of the default.
    if (electrum) {
      this.electrum = electrum;
      return;
    }

    if (network === Network.MAINNET) {
      // Radiant mainnet: Radiant Core public RXinDexer node.
      // Primary: WSS proxied via Caddy TLS at electrumx.radiantcore.org:443.
      // Fallback: direct SSL at 82.180.136.182:50012.
      // Override by passing a custom ElectrumCluster as the second constructor argument.
      // minWorkers=1 means at least one server must be healthy before requests are served.
      this.electrum = new ElectrumCluster('RadiantScript', '1.4.1', 1, 2, ClusterOrder.PRIORITY);
      this.electrum.addServer('electrumx.radiantcore.org', 443, ElectrumTransport.WSS.Scheme, false);
      // electrum-cash exposes TLS-over-TCP as TCP_TLS (scheme 'tcp_tls'); the
      // older alias `SSL` does not exist on the typed surface.
      this.electrum.addServer('82.180.136.182', 50012, ElectrumTransport.TCP_TLS.Scheme, false);
    } else if (network === Network.TESTNET) {
      // Radiant testnet: pass a custom ElectrumCluster for your testnet RXinDexer node.
      throw new Error(
        'No default Radiant testnet servers configured. '
        + 'Pass a custom ElectrumCluster pointing to your testnet RXinDexer instance.',
      );
    } else if (network === Network.REGTEST) {
      // Regtest: connect to local RXinDexer on default TCP port
      this.electrum = new ElectrumCluster('RadiantScript Application', '1.4.1', 1, 1, ClusterOrder.PRIORITY);
      this.electrum.addServer('localhost', 50010, ElectrumTransport.TCP.Scheme, false);
    } else {
      throw new Error(`Tried to instantiate an ElectrumNetworkProvider for unsupported network ${network}`);
    }
  }

  async getUtxos(address: string): Promise<Utxo[]> {
    const scripthash = addressToElectrumScriptHash(address);

    const result = await this.performRequest('blockchain.scripthash.listunspent', scripthash) as ElectrumUtxo[];

    // Providers are untrusted — validate each UTXO before returning it (M-4).
    const utxos = result.map((utxo) => validateUtxo({
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      satoshis: utxo.value,
      height: utxo.height,
    }));

    return utxos;
  }

  async getBlockHeight(): Promise<number> {
    const { height } = await this.performRequest('blockchain.headers.subscribe') as BlockHeader;

    return height;
  }

  async getRawTransaction(txid: string): Promise<string> {
    return await this.performRequest('blockchain.transaction.get', txid) as string;
  }

  async sendRawTransaction(txHex: string): Promise<string> {
    return await this.performRequest('blockchain.transaction.broadcast', txHex) as string;
  }

  async connectCluster(): Promise<void[]> {
    try {
      return await this.electrum.startup();
    } catch (e) {
      return [];
    }
  }

  async disconnectCluster(): Promise<boolean[]> {
    return this.electrum.shutdown();
  }

  private async performRequest(
    name: string,
    ...parameters: (string | number | boolean)[]
  ): Promise<RequestResponse> {
    // Check circuit breaker
    this.checkCircuitBreaker();

    // Check rate limiting
    this.enforceRateLimit();

    // Check concurrent request limit
    if (this.concurrentRequests >= ElectrumNetworkProvider.MAX_CONCURRENT_REQUESTS) {
      throw new Error(`Too many concurrent requests: maximum is ${ElectrumNetworkProvider.MAX_CONCURRENT_REQUESTS}`);
    }

    // Only connect the cluster when no concurrent requests are running
    if (this.shouldConnect()) {
      this.connectCluster();
    }

    this.concurrentRequests += 1;

    await Promise.race([
      this.electrum.ready(),
      this.createTimeout(ElectrumNetworkProvider.REQUEST_TIMEOUT_MS),
    ]);

    let result: RequestResponse | undefined;
    let lastError: Error | undefined;

    try {
      // Retry loop with exponential backoff
      for (let attempt = 0; attempt < ElectrumNetworkProvider.MAX_RETRIES; attempt++) {
        try {
          result = await this.executeRequestWithTimeout(name, parameters);
          this.recordSuccess();
          break; // Success - exit retry loop
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          this.recordFailure();

          // Don't retry on certain errors
          if (this.isNonRetryableError(lastError)) {
            throw lastError;
          }

          if (attempt < ElectrumNetworkProvider.MAX_RETRIES - 1) {
            const delay = this.calculateRetryDelay(attempt);
            await this.sleep(delay);
          }
        }
      }

      if (result === undefined && lastError) {
        throw lastError;
      }
    } finally {
      // Always disconnect the cluster, also if the request fails
      // as long as no other concurrent requests are running
      if (this.shouldDisconnect()) {
        await this.disconnectCluster();
      }
      this.concurrentRequests -= 1;
    }

    if (result instanceof Error) throw result;
    if (result === undefined) {
      // Defence in depth: all paths above either assign `result` or throw.
      // This guards against future refactors that might break that invariant.
      throw lastError ?? new Error('ElectrumNetworkProvider: request produced no result');
    }

    return result;
  }

  private async executeRequestWithTimeout(
    name: string,
    parameters: (string | number | boolean)[],
  ): Promise<RequestResponse> {
    return Promise.race([
      this.electrum.request(name, ...parameters),
      this.createTimeout(ElectrumNetworkProvider.REQUEST_TIMEOUT_MS),
    ]);
  }

  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Request timeout after ${ms}ms`)), ms);
    });
  }

  private calculateRetryDelay(attempt: number): number {
    const exponentialDelay = ElectrumNetworkProvider.BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    return Math.min(exponentialDelay + jitter, ElectrumNetworkProvider.MAX_RETRY_DELAY_MS);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isNonRetryableError(error: Error): boolean {
    // Don't retry on authentication errors, malformed requests, etc.
    const nonRetryablePatterns = [
      'invalid parameter',
      'invalid request',
      'method not found',
      'parse error',
    ];
    return nonRetryablePatterns.some((pattern) =>
      error.message.toLowerCase().includes(pattern),
    );
  }

  private enforceRateLimit(): void {
    const now = Date.now();
    const windowStart = now - ElectrumNetworkProvider.RATE_LIMIT_WINDOW_MS;

    // Remove timestamps outside the window
    this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > windowStart);

    if (this.requestTimestamps.length >= ElectrumNetworkProvider.MAX_REQUESTS_PER_WINDOW) {
      throw new Error(`Rate limit exceeded: maximum ${ElectrumNetworkProvider.MAX_REQUESTS_PER_WINDOW} requests per second`);
    }

    this.requestTimestamps.push(now);
  }

  private checkCircuitBreaker(): void {
    const now = Date.now();
    const timeSinceLastFailure = now - this.circuitBreakerLastFailure;

    // Reset circuit breaker if enough time has passed
    if (timeSinceLastFailure > ElectrumNetworkProvider.CIRCUIT_BREAKER_RESET_MS) {
      this.circuitBreakerFailures = 0;
    }

    if (this.circuitBreakerFailures >= ElectrumNetworkProvider.CIRCUIT_BREAKER_THRESHOLD) {
      const remainingCooldown = ElectrumNetworkProvider.CIRCUIT_BREAKER_RESET_MS - timeSinceLastFailure;
      throw new Error(`Circuit breaker is open. Too many failures. Try again in ${Math.ceil(remainingCooldown / 1000)}s`);
    }
  }

  private recordSuccess(): void {
    this.circuitBreakerFailures = 0;
  }

  private recordFailure(): void {
    this.circuitBreakerFailures += 1;
    this.circuitBreakerLastFailure = Date.now();
  }

  private shouldConnect(): boolean {
    if (this.manualConnectionManagement) return false;
    if (this.concurrentRequests !== 0) return false;
    return true;
  }

  private shouldDisconnect(): boolean {
    if (this.manualConnectionManagement) return false;
    if (this.concurrentRequests !== 1) return false;
    return true;
  }
}

interface ElectrumUtxo {
  tx_pos: number;
  value: number;
  tx_hash: string;
  height: number;
}

interface BlockHeader {
  height: number;
  hex: string;
}

/**
 * Helper function to convert an address to an electrum-cash compatible scripthash.
 * This is necessary to support electrum versions lower than 1.4.3, which do not
 * support addresses, only script hashes.
 *
 * @param address Address to convert to an electrum scripthash
 *
 * @returns The corresponding script hash in an electrum-cash compatible format
 */
function addressToElectrumScriptHash(address: string): string {
  // Retrieve locking script
  const lockScript = addressToLockScript(address);

  // Hash locking script
  const scriptHash = sha256(lockScript);

  // Reverse scripthash
  scriptHash.reverse();

  // Return scripthash as a hex string
  return binToHex(scriptHash);
}
