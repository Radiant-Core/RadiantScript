# Local Development Environment

Spin up a full Radiant stack (node + RXinDexer) on your machine for contract testing without touching mainnet.

## Prerequisites

- Docker and Docker Compose v2+
- Ports `50010` (TCP), `50012` (SSL), `8000` (REST API) available locally

## Quick Start

```bash
# Clone RXinDexer
git clone https://github.com/Radiant-Core/RXinDexer.git
cd RXinDexer/docker/full-stack

# Create a local .env (regtest mode)
cat > .env <<'EOF'
RPC_USER=radiant
RPC_PASS=radiant
CACHE_MB=256
GLYPH_INDEX=0
WAVE_INDEX=0
SWAP_INDEX=0
COIN=RXD
NET=regtest
EOF

# Start
docker compose up -d
```

The stack starts two containers:
- **radiantd** — Radiant full node in regtest mode (RPC on `127.0.0.1:7332`)
- **rxindexer** — RXinDexer Electrum server (TCP on `localhost:50010`)

## Connect RadiantScript to Regtest

```typescript
import { ElectrumNetworkProvider, Network } from 'radiantscript';

// Regtest is pre-wired to localhost:50010 — no extra config needed
const provider = new ElectrumNetworkProvider(Network.REGTEST);
```

## Generate Test Coins

```bash
# Mine 101 blocks to activate coinbase maturity
docker exec radiantd radiant-cli \
  -rpcuser=radiant -rpcpassword=radiant \
  generatetoaddress 101 $(docker exec radiantd radiant-cli \
    -rpcuser=radiant -rpcpassword=radiant \
    getnewaddress)
```

## Broadcast a Test Transaction

```typescript
import { ElectrumNetworkProvider, Network } from 'radiantscript';

const provider = new ElectrumNetworkProvider(Network.REGTEST);
const txid = await provider.sendRawTransaction('<your_raw_hex>');
console.log('txid:', txid);
```

## RXinDexer REST API (regtest)

```bash
# Health check
curl http://localhost:8000/health

# Check indexed UTXOs for an address
curl http://localhost:8000/blockchain.scripthash.listunspent?scripthash=<hash>
```

## Connecting to the Public Radiant Core Node (Mainnet)

The Radiant Core VPS runs a public RXinDexer instance accessible over WSS:

| Endpoint | Protocol | Port |
|----------|----------|------|
| `electrumx.radiantcore.org` | WSS (TLS) | 443 |
| `82.180.136.182` | TCP | 50010 |
| `82.180.136.182` | SSL | 50012 |

```typescript
import { ElectrumNetworkProvider, Network } from 'radiantscript';

// Mainnet — connects automatically to electrumx.radiantcore.org:443 (WSS)
const provider = new ElectrumNetworkProvider(Network.MAINNET);

// Or point to the raw TCP port directly
import { ElectrumCluster, ElectrumTransport, ClusterOrder } from 'electrum-cash';
const cluster = new ElectrumCluster('MyApp', '1.4.1', 1, 1, ClusterOrder.PRIORITY);
cluster.addServer('82.180.136.182', 50010, ElectrumTransport.TCP.Scheme, false);
const provider = new ElectrumNetworkProvider(Network.MAINNET, cluster);
```

## Stopping the Stack

```bash
cd RXinDexer/docker/full-stack
docker compose down
```

To wipe all data and start fresh:
```bash
docker compose down -v
```
