import { DeploymentConfig } from './types';

export interface NetworkConfig {
  name: string;
  electrumServers: ElectrumServer[];
  explorerUrl: string;
}

export interface ElectrumServer {
  host: string;
  port: number;
  protocol: 'tcp' | 'ssl';
}

const MAINNET_CONFIG: NetworkConfig = {
  name: 'mainnet',
  electrumServers: [
    { host: 'electrumx.radiant4people.com', port: 50012, protocol: 'ssl' },
    { host: 'electrumx.radiantblockchain.org', port: 50012, protocol: 'ssl' },
  ],
  explorerUrl: 'https://radiantexplorer.com',
};

const TESTNET_CONFIG: NetworkConfig = {
  name: 'testnet',
  electrumServers: [
    { host: 'electrumx-testnet.radiant4people.com', port: 50012, protocol: 'ssl' },
  ],
  explorerUrl: 'https://testnet.radiantexplorer.com',
};

export function getNetworkConfig(network: 'mainnet' | 'testnet'): NetworkConfig {
  return network === 'mainnet' ? MAINNET_CONFIG : TESTNET_CONFIG;
}

export function createDeploymentConfig(
  network: 'mainnet' | 'testnet',
  serverIndex: number = 0
): DeploymentConfig {
  const config = getNetworkConfig(network);
  const server = config.electrumServers[serverIndex] || config.electrumServers[0];
  
  return {
    network,
    electrumHost: server.host,
    electrumPort: server.port,
    electrumProtocol: server.protocol,
  };
}
