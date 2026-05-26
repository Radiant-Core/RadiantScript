import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
  hash160,
} from 'radiantscript';
import { compileFile } from 'rxdc';
import { PrivateKey } from '@radiant-core/radiantjs';

// FungibleToken Usage Example
// Demonstrates minting, transferring, and burning fungible tokens
//
// CRITICAL: For stateful contracts, ownership is stored in the UTXO state section.
// When transferring to a new owner, you MUST use buildStatefulOutput() to create
// an output with the new owner's pkh in the state section.

async function main() {
  // Compile the contract with debug info for rxdeb
  const artifact = compileFile('./FungibleToken.rxd', { debug: true });

  // Connect to Electrum
  const provider = new ElectrumNetworkProvider('mainnet');

  // Setup CURRENT OWNER keys
  // SECURITY: Never hardcode private keys. Use environment variables or secure key management.
  const ownerPrivKey = PrivateKey.fromWIF(
    process.env.PRIVATE_KEY_WIF || 'your-private-key-wif'
  );
  const ownerPubKey = ownerPrivKey.toPublicKey();
  const ownerPk = ownerPubKey.toBuffer();

  // Setup NEW OWNER keys (the recipient of the transfer)
  const newOwnerPrivKey = PrivateKey.fromWIF(
    process.env.NEW_OWNER_WIF || 'new-owner-private-key-wif'
  );
  const newOwnerPubKey = newOwnerPrivKey.toPublicKey();
  const newOwnerPk = newOwnerPubKey.toBuffer();

  // Token reference (36 bytes: 32-byte txid + 4-byte vout in little-endian)
  const tokenRef = '0x' + 'a'.repeat(64) + '00000000';

  // Instantiate the contract
  // Note: FungibleToken constructor only takes tokenRef, not owner pubkey.
  // Ownership is stored in each UTXO's state section.
  const contract = new Contract(artifact, [tokenRef], { provider });

  console.log('Contract address:', contract.address);
  console.log('Contract balance:', await contract.getBalance());

  // Get contract UTXOs
  const utxos = await contract.getUtxos();
  console.log('Contract UTXOs:', utxos.length);

  // Example: Transfer tokens to NEW OWNER
  if (utxos.length > 0) {
    // CRITICAL: Build stateful output with NEW owner's pkh in state section
    const newOwnerPkh = hash160(newOwnerPk);
    const statefulOutput = contract.buildStatefulOutput(newOwnerPkh);

    console.log('New owner PKH:', Buffer.from(newOwnerPkh).toString('hex'));

    const transferTx = await contract.functions
      .transfer(ownerPk, new SignatureTemplate(ownerPrivKey))
      // Use stateful output (Uint8Array) NOT address string for stateful contracts!
      .to(statefulOutput, utxos[0].satoshis)
      .send();

    console.log('Transfer TX:', transferTx.txid);
    console.log('New owner can now spend using their private key');
  }

  // Example: Burn tokens (current owner burns their own tokens)
  // if (utxos.length > 0) {
  //   const burnAmount = 100;
  //   // For burn, output goes back to current owner (or any address)
  //   const statefulOutput = contract.buildStatefulOutput(hash160(ownerPk));
  //   const burnTx = await contract.functions
  //     .burn(ownerPk, new SignatureTemplate(ownerPrivKey), burnAmount)
  //     .to(statefulOutput, utxos[0].satoshis - burnAmount)
  //     .send();
  //   console.log('Burn TX:', burnTx.txid);
  // }
}

// Debug with rxdeb:
// 1. Compile: npx rxdc FungibleToken.rxd -o FungibleToken.json --debug
// 2. Get transaction hex from above
// 3. Debug: rxdeb --artifact=FungibleToken.json --tx=<hex>

main().catch(console.error);
