import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'radiantscript';
import { compileFile } from 'rxdc';
import {
  PrivateKey,
} from '@radiant-core/radiantjs';

// FungibleToken Usage Example
// Demonstrates minting, transferring, and burning fungible tokens

async function main() {
  // Compile the contract with debug info for rxdeb
  const artifact = compileFile('./FungibleToken.rxd', { debug: true });
  
  // Connect to Electrum
  const provider = new ElectrumNetworkProvider('mainnet');
  
  // Setup keys
  // SECURITY: Never hardcode private keys. Use environment variables or secure key management.
  const ownerPrivKey = PrivateKey.fromWIF(process.env.PRIVATE_KEY_WIF || 'your-private-key-wif');
  const ownerPubKey = ownerPrivKey.toPublicKey();
  
  // Token reference (36 bytes: 32-byte txid + 4-byte vout in little-endian)
  // This would be the outpoint of the genesis transaction
  // SECURITY: In production, generate this from an actual UTXO using:
  //   const outpointHash = crypto.randomBytes(32).toString('hex'); // or actual tx hash
  //   const tokenRef = '0x' + outpointHash + vout.toString(16).padStart(8, '0');
  const tokenRef = '0x' + 'a'.repeat(64) + '00000000'; // Example reference - DO NOT USE IN PRODUCTION
  
  // Instantiate the contract
  const contract = new Contract(artifact, [tokenRef, ownerPubKey.toBuffer()], {
    provider,
  });
  
  console.log('Contract address:', contract.address);
  console.log('Contract balance:', await contract.getBalance());
  
  // Get contract UTXOs
  const utxos = await contract.getUtxos();
  console.log('Contract UTXOs:', utxos.length);
  
  // Example: Transfer tokens
  if (utxos.length > 0) {
    const transferTx = await contract.functions
      .transfer(new SignatureTemplate(ownerPrivKey))
      .to(contract.address, 1000) // Send 1000 sats worth of tokens
      .send();
    
    console.log('Transfer TX:', transferTx.txid);
  }
  
  // Example: Burn tokens
  // const burnAmount = 100;
  // const burnTx = await contract.functions
  //   .burn(new SignatureTemplate(ownerPrivKey), burnAmount)
  //   .to(contract.address, utxos[0].satoshis - burnAmount)
  //   .send();
  // console.log('Burn TX:', burnTx.txid);
}

// Debug with rxdeb:
// 1. Compile: npx rxdc FungibleToken.rxd -o FungibleToken.json --debug
// 2. Get transaction hex from above
// 3. Debug: rxdeb --artifact=FungibleToken.json --tx=<hex>

main().catch(console.error);
