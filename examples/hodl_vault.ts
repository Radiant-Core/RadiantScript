/**
 * Example: HODL Vault on Radiant.
 *
 * Rewritten off `bitbox-sdk` onto `@bitauth/libauth` to align with the
 * Radiant-native `PriceOracle` (see `./PriceOracle.ts`). Requires a running
 * Radiant ElectrumX endpoint for `getBalance()` / `send()`; the keys used
 * here are deterministic test material, do not reuse them on mainnet.
 */
import { instantiateSecp256k1, stringify } from '@bitauth/libauth';
import { Contract, SignatureTemplate, ElectrumNetworkProvider } from 'radiantscript';
import { compileFile } from '@radiantscript/rxdc';
import path from 'path';
import { PriceOracle } from './PriceOracle.js';

run();
async function run(): Promise<void> {
  const secp = await instantiateSecp256k1();

  // Deterministic 32-byte private keys. Test material only — DO NOT REUSE.
  const ownerPrivateKey = new Uint8Array(32).fill(0x11);
  const oraclePrivateKey = new Uint8Array(32).fill(0x22);

  const ownerPk = secp.derivePublicKeyCompressed(ownerPrivateKey);
  const oracle = await PriceOracle.create(oraclePrivateKey);
  const oraclePk = oracle.publicKey;

  // Compile the HodlVault contract to an artifact object.
  const artifact = compileFile(path.join(__dirname, 'hodl_vault.cash'));

  // Initialise a network provider for network operations on TESTNET.
  const provider = new ElectrumNetworkProvider('testnet');

  // Instantiate a new contract using the compiled artifact and network
  // provider AND providing the constructor parameters.
  const parameters = [ownerPk, oraclePk, 597000, 30000];
  const contract = new Contract(artifact, parameters, provider);

  // Get contract balance & output address + balance.
  console.log('contract address:', contract.address);
  console.log('contract balance:', await contract.getBalance());

  // Produce new oracle message and signature.
  const oracleMessage = oracle.createMessage(597000, 30000);
  const oracleSignature = oracle.signMessage(oracleMessage);

  // Spend from the vault.
  const tx = await contract.functions
    .spend(new SignatureTemplate(ownerPrivateKey), oracleSignature, oracleMessage)
    .to(contract.address, 1000)
    .send();

  console.log(stringify(tx));
}
