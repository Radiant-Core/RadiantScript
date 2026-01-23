import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'cashscript';
import { compileFile } from 'cashc';
import { 
  PrivateKey,
  PublicKey,
  Transaction,
} from '@AirdropScripts/radiantjs';

// FungibleToken Usage Example
// Demonstrates minting, transferring, and burning fungible tokens

async function main() {
  // Compile the contract with debug info for rxdeb
  const artifact = compileFile('./FungibleToken.rxd', { debug: true });
  
  // Connect to Electrum
  const provider = new ElectrumNetworkProvider('mainnet');
  
  // Setup keys
  const ownerPrivKey = PrivateKey.fromWIF('your-private-key-wif');
  const ownerPubKey = ownerPrivKey.toPublicKey();
  
  // Token reference (36 bytes: 32-byte txid + 4-byte vout in little-endian)
  // This would be the outpoint of the genesis transaction
  const tokenRef = '0x' + 'a'.repeat(64) + '00000000'; // Example reference
  
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
