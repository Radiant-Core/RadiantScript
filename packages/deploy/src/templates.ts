import { TemplateConfig } from './types';

export interface ContractTemplate {
  config: TemplateConfig;
  source: string;
}

const FUNGIBLE_TOKEN_TEMPLATE: ContractTemplate = {
  config: {
    name: 'FungibleToken',
    description: 'Standard fungible token with mint and transfer capabilities',
    category: 'token',
    parameters: [
      { name: 'name', type: 'string', description: 'Token name', required: true },
      { name: 'symbol', type: 'string', description: 'Token symbol (3-5 chars)', required: true },
      { name: 'decimals', type: 'number', description: 'Decimal places', required: true, default: 8 },
      { name: 'initialSupply', type: 'number', description: 'Initial supply to mint', required: true },
      { name: 'mintAuthority', type: 'address', description: 'Address authorized to mint', required: true },
    ],
  },
  source: `pragma radiant ^0.7.0;

contract FungibleToken(
    pubkey mintAuthority
) {
    function transfer(sig ownerSig, pubkey ownerPk) {
        require(checkSig(ownerSig, ownerPk));
    }

    function mint(sig authSig) {
        require(checkSig(authSig, mintAuthority));
    }
}
`,
};

const NFT_TEMPLATE: ContractTemplate = {
  config: {
    name: 'NFT',
    description: 'Non-fungible token with singleton reference',
    category: 'nft',
    parameters: [
      { name: 'name', type: 'string', description: 'NFT collection name', required: true },
      { name: 'creator', type: 'address', description: 'Creator address', required: true },
    ],
  },
  source: `pragma radiant ^0.7.0;

contract NFT(
    pubkey creator
) {
    function transfer(sig ownerSig, pubkey ownerPk) {
        require(checkSig(ownerSig, ownerPk));
    }

    function burn(sig ownerSig, pubkey ownerPk) {
        require(checkSig(ownerSig, ownerPk));
    }
}
`,
};

const MULTISIG_VAULT_TEMPLATE: ContractTemplate = {
  config: {
    name: 'MultiSigVault',
    description: 'Multi-signature vault requiring M-of-N signatures',
    category: 'utility',
    parameters: [
      { name: 'requiredSigs', type: 'number', description: 'Required signatures (M)', required: true, default: 2 },
      { name: 'signer1', type: 'address', description: 'First signer public key', required: true },
      { name: 'signer2', type: 'address', description: 'Second signer public key', required: true },
      { name: 'signer3', type: 'address', description: 'Third signer public key', required: false },
    ],
  },
  source: `pragma radiant ^0.7.0;

contract MultiSigVault(
    int requiredSigs,
    pubkey signer1,
    pubkey signer2,
    pubkey signer3
) {
    function spend(
        sig s1,
        sig s2,
        sig s3
    ) {
        int count = 0;
        if (checkSig(s1, signer1)) count = count + 1;
        if (checkSig(s2, signer2)) count = count + 1;
        if (checkSig(s3, signer3)) count = count + 1;
        require(count >= requiredSigs);
    }
}
`,
};

const DMINT_TOKEN_TEMPLATE: ContractTemplate = {
  config: {
    name: 'dMintToken',
    description: 'Decentralized minting token with proof-of-work',
    category: 'token',
    parameters: [
      { name: 'name', type: 'string', description: 'Token name', required: true },
      { name: 'symbol', type: 'string', description: 'Token symbol', required: true },
      { name: 'maxSupply', type: 'number', description: 'Maximum total supply', required: true },
      { name: 'rewardPerMint', type: 'number', description: 'Tokens per successful mint', required: true },
      { name: 'difficulty', type: 'number', description: 'Initial mining difficulty', required: true },
    ],
  },
  source: `pragma radiant ^0.7.0;

contract dMintToken(
    int maxSupply,
    int rewardPerMint,
    bytes32 difficultyTarget
) {
    function mint(bytes nonce) {
        bytes32 hash = sha256(sha256(this.activeBytecode + nonce));
        require(hash < difficultyTarget);
    }

    function transfer(sig ownerSig, pubkey ownerPk) {
        require(checkSig(ownerSig, ownerPk));
    }
}
`,
};

const TIMELOCK_TEMPLATE: ContractTemplate = {
  config: {
    name: 'TimeLock',
    description: 'Time-locked funds that can only be spent after a specified block height',
    category: 'utility',
    parameters: [
      { name: 'unlockHeight', type: 'number', description: 'Block height when funds unlock', required: true },
      { name: 'recipient', type: 'address', description: 'Recipient public key', required: true },
    ],
  },
  source: `pragma radiant ^0.7.0;

contract TimeLock(
    int unlockHeight,
    pubkey recipient
) {
    function spend(sig recipientSig) {
        require(tx.locktime >= unlockHeight);
        require(checkSig(recipientSig, recipient));
    }
}
`,
};

const TEMPLATES: Map<string, ContractTemplate> = new Map([
  ['FungibleToken', FUNGIBLE_TOKEN_TEMPLATE],
  ['NFT', NFT_TEMPLATE],
  ['MultiSigVault', MULTISIG_VAULT_TEMPLATE],
  ['dMintToken', DMINT_TOKEN_TEMPLATE],
  ['TimeLock', TIMELOCK_TEMPLATE],
]);

export function getTemplate(name: string): ContractTemplate | undefined {
  return TEMPLATES.get(name);
}

export function listTemplates(): TemplateConfig[] {
  return Array.from(TEMPLATES.values()).map((t) => t.config);
}

export function getTemplatesByCategory(category: TemplateConfig['category']): ContractTemplate[] {
  return Array.from(TEMPLATES.values()).filter((t) => t.config.category === category);
}
