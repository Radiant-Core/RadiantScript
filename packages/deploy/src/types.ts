export interface DeploymentConfig {
  network: 'mainnet' | 'testnet';
  electrumHost: string;
  electrumPort: number;
  electrumProtocol: 'tcp' | 'ssl';
}

export interface WalletConfig {
  privateKey?: string;
  mnemonic?: string;
  derivationPath?: string;
}

export interface DeploymentResult {
  success: boolean;
  txid?: string;
  contractAddress?: string;
  error?: string;
  gasUsed?: number;
  fee?: number;
}

export interface ContractArtifact {
  contractName?: string;
  contract?: string;
  constructorInputs?: ConstructorInput[];
  abi?: AbiFunction[];
  bytecode?: string;
  source?: string;
  compiler?: {
    name: string;
    version: string;
  };
  updatedAt?: string;
  // Support for rxdc Artifact format
  [key: string]: unknown;
}

export interface ConstructorInput {
  name: string;
  type: string;
}

export interface AbiFunction {
  name: string;
  inputs: FunctionInput[];
}

export interface FunctionInput {
  name: string;
  type: string;
}

export interface TemplateConfig {
  name: string;
  description: string;
  category: 'token' | 'nft' | 'defi' | 'utility';
  parameters: TemplateParameter[];
}

export interface TemplateParameter {
  name: string;
  type: 'string' | 'number' | 'address' | 'boolean';
  description: string;
  required: boolean;
  default?: string | number | boolean;
}

export interface DeployOptions {
  artifact: ContractArtifact;
  constructorArgs: (string | number | Buffer)[];
  initialBalance?: number;
  feeRate?: number;
}
