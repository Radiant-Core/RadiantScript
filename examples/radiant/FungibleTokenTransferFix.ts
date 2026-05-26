import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
  buildStatefulOutput,
  splitStatefulBytecode,
  hash160,
} from 'radiantscript';
import { compileFile } from 'rxdc';
import { PrivateKey } from '@radiant-core/radiantjs';
import { hexToBin, binToHex } from '@bitauth/libauth';

/**
 * FungibleToken State-Aware Transfer Example
 *
 * This demonstrates the CORRECT way to transfer stateful contracts where
 * ownership is stored in the UTXO's state section (like wave names/domains).
 *
 * The key insight: When transferring, the output MUST have the new owner's
 * pkh in its state section, otherwise the new owner can never sign.
 */

async function main() {
  // Compile the contract
  const artifact = compileFile('./FungibleToken.rxd', { debug: true });

  // Connect to network
  const provider = new ElectrumNetworkProvider('mainnet');

  // Setup keys
  const currentOwnerPrivKey = PrivateKey.fromWIF(
    process.env.CURRENT_OWNER_WIF || 'your-current-owner-wif'
  );
  const currentOwnerPubKey = currentOwnerPrivKey.toPublicKey();
  const currentOwnerPk = currentOwnerPubKey.toBuffer();

  // NEW OWNER keys (the recipient)
  const newOwnerPrivKey = PrivateKey.fromWIF(
    process.env.NEW_OWNER_WIF || 'your-new-owner-wif'
  );
  const newOwnerPubKey = newOwnerPrivKey.toPublicKey();
  const newOwnerPk = newOwnerPubKey.toBuffer();

  // Token reference
  const tokenRef = '0x' + 'a'.repeat(64) + '00000000';

  // Instantiate contract (constructor only takes tokenRef, not owner)
  const contract = new Contract(artifact, [tokenRef], { provider });

  console.log('Contract address:', contract.address);

  // Get contract UTXOs
  const utxos = await contract.getUtxos();
  console.log('Available UTXOs:', utxos.length);

  if (utxos.length === 0) {
    console.log('No UTXOs available to transfer');
    return;
  }

  const utxo = utxos[0];
  console.log('UTXO to spend:', utxo.txid, 'vout:', utxo.vout);

  // ==========================================
  // CRITICAL FIX: Build stateful output with NEW owner's pkh
  // ==========================================

  // Step 1: Get the code script (redeem script bytecode)
  const codeScript = hexToBin(contract.getRedeemScriptHex());

  // Step 2: Compute new owner's pkh (20 bytes)
  const newOwnerPkh = hash160(newOwnerPk);
  console.log('New owner PKH:', binToHex(newOwnerPkh));

  // Step 3: Build stateful output: <push:newOwnerPkh> OP_STATESEPARATOR <codeScript>
  const statefulOutput = buildStatefulOutput(newOwnerPkh, codeScript);
  console.log('Stateful output bytecode:', binToHex(statefulOutput).slice(0, 100) + '...');

  // Step 4: Verify the state section contains the new owner's pkh
  const split = splitStatefulBytecode(statefulOutput);
  if (split) {
    // stateData includes the push opcode, so extract just the payload
    const statePkh = split.stateData.slice(split.stateData.length - 20);
    console.log('State section PKH:', binToHex(statePkh));
    console.log('Matches new owner:', binToHex(statePkh) === binToHex(newOwnerPkh));
  }

  // ==========================================
  // Perform the transfer with RAW LOCKING BYTECODE
  // ==========================================

  console.log('\n--- Executing Transfer ---');

  try {
    const transferTx = await contract.functions
      .transfer(currentOwnerPk, new SignatureTemplate(currentOwnerPrivKey))
      // CRITICAL: Pass raw locking bytecode (Uint8Array), NOT an address string!
      // This ensures the output has the state section with new owner's pkh
      .to(statefulOutput, utxo.satoshis)
      .send();

    console.log('Transfer successful!');
    console.log('Transaction ID:', transferTx.txid);
    console.log('\nNew owner can now sign with their private key');

    // ==========================================
    // Verify new owner can sign (demonstration)
    // ==========================================

    console.log('\n--- Verifying New Owner Can Sign ---');

    // The new UTXO is now at the transferTx output 0
    const newUtxo = {
      txid: transferTx.txid,
      vout: 0,
      satoshis: utxo.satoshis,
    };

    // Create a "spend" transaction to verify new owner can sign
    // (In practice, this would be a real transfer or burn)
    console.log('New UTXO for new owner:', newUtxo);
    console.log('New owner can spend using:');
    console.log('  - Their private key (newOwnerPrivKey)');
    console.log('  - Their public key (newOwnerPk) which matches pkh in state');

  } catch (error) {
    console.error('Transfer failed:', error);
    throw error;
  }
}

/**
 * Helper function for Photonic Wallet integration
 *
 * This is what Photonic Wallet should use when changing the Target address
 * (transferring a wave name to a new owner).
 */
export async function transferStatefulContract(
  contract: Contract,
  artifact: any,
  currentOwnerPrivKey: any,
  currentOwnerPubKey: any,
  newOwnerPubKey: any,
  utxo: { txid: string; vout: number; satoshis: number }
): Promise<string> {
  // Get code script
  const codeScript = hexToBin(contract.getRedeemScriptHex());

  // Compute new owner's pkh
  const newOwnerPkh = hash160(newOwnerPubKey);

  // Build stateful output with new owner's pkh
  const statefulOutput = buildStatefulOutput(newOwnerPkh, codeScript);

  // Execute transfer with raw locking bytecode
  const transferTx = await contract.functions
    .transfer(currentOwnerPubKey, new SignatureTemplate(currentOwnerPrivKey))
    .to(statefulOutput, utxo.satoshis)
    .send();

  return transferTx.txid;
}

main().catch(console.error);
