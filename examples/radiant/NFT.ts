import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'radiantscript';
import { compileFile } from '@radiantscript/rxdc';
import { PrivateKey } from '@radiant-core/radiantjs';

// NFT (Non-Fungible Token) Usage Example
// Demonstrates minting and transferring singleton NFTs

async function main() {
  // Compile with debug info
  const artifact = compileFile('./NFT.rxd', { debug: true });
  
  // Connect to network
  const provider = new ElectrumNetworkProvider('mainnet');
  
  // Setup owner keys
  // SECURITY: Never hardcode private keys. Use environment variables or secure key management.
  const ownerPrivKey = PrivateKey.fromWIF(process.env.PRIVATE_KEY_WIF || 'your-private-key-wif');
  const ownerPubKey = ownerPrivKey.toPublicKey();
  
  // New owner for transfer
  const newOwnerPubKey = PrivateKey.fromRandom().toPublicKey();
  
  // NFT reference (unique identifier from genesis tx)
  // SECURITY: In production, generate this from an actual UTXO using:
  //   const outpointHash = crypto.randomBytes(32).toString('hex'); // or actual tx hash
  //   const nftRef = '0x' + outpointHash + vout.toString(16).padStart(8, '0');
  const nftRef = '0x' + 'b'.repeat(64) + '00000000'; // Example - DO NOT USE IN PRODUCTION
  
  // Instantiate contract
  const contract = new Contract(artifact, [nftRef, ownerPubKey.toBuffer()], {
    provider,
  });
  
  console.log('NFT Contract address:', contract.address);
  
  // Get NFT UTXO
  const utxos = await contract.getUtxos();
  
  if (utxos.length > 0) {
    // Transfer NFT to new owner
    // Create new contract instance with new owner
    const newContract = new Contract(artifact, [nftRef, newOwnerPubKey.toBuffer()], {
      provider,
    });
    
    const transferTx = await contract.functions
      .transfer(new SignatureTemplate(ownerPrivKey))
      .to(newContract.address, utxos[0].satoshis)
      .send();
    
    console.log('NFT Transfer TX:', transferTx.txid);
    console.log('New owner address:', newContract.address);
  }
  
  // Transfer with data update
  // const newData = Buffer.from('ipfs://QmNewMetadataHash');
  // const transferWithDataTx = await contract.functions
  //   .transferWithData(new SignatureTemplate(ownerPrivKey), newData)
  //   .to(newContract.address, utxos[0].satoshis)
  //   .send();
}

// Debugging:
// rxdeb --artifact=NFT.json --tx=<transfer_tx_hex>

main().catch(console.error);
