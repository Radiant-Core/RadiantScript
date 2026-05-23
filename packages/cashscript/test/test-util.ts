import {
  encodeBase58AddressFormat,
  hexToBin,
  Transaction,
  binToHex,
  binToBigIntUint64LE,
} from '@bitauth/libauth';
import { sha256 } from '@radiantscript/utils';
import { Output, Network } from '../src/interfaces.js';
import { network as defaultNetwork } from './fixture/vars.js';
import { getP2SHVersionByte } from '../src/utils.js';

const sha256Adapter = { hash: (input: Uint8Array): Uint8Array => sha256(input) };

/**
 * Convert the raw outputs of a built transaction into `Output` records with
 * Radiant base58 addresses (for OP_RETURN, the raw bytecode is preserved).
 *
 * Recognised script templates:
 *   - `OP_HASH160 <20 bytes> OP_EQUAL`                                 → P2SH
 *   - `OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG`        → P2PKH
 *   - Anything starting with `OP_RETURN` (0x6a)                        → raw bytes
 *
 * Tests use this to compare on-chain output addresses against expected ones
 * without re-encoding the entire transaction.
 */
export function getTxOutputs(tx: Transaction, network: Network = defaultNetwork): Output[] {
  return tx.outputs.map((o) => {
    const bytecode = o.lockingBytecode;
    const amount = Number(binToBigIntUint64LE(o.satoshis));

    // OP_RETURN: preserve as raw bytes.
    if (bytecode[0] === 0x6a) {
      return { to: hexToBin(binToHex(bytecode)), amount: 0 };
    }

    // P2SH:  a9 14 <20> 87
    if (
      bytecode.length === 23
      && bytecode[0] === 0xa9
      && bytecode[1] === 0x14
      && bytecode[22] === 0x87
    ) {
      const hash = bytecode.slice(2, 22);
      const version = getP2SHVersionByte(network);
      return { to: encodeBase58AddressFormat(sha256Adapter, version, hash), amount };
    }

    // P2PKH: 76 a9 14 <20> 88 ac
    if (
      bytecode.length === 25
      && bytecode[0] === 0x76
      && bytecode[1] === 0xa9
      && bytecode[2] === 0x14
      && bytecode[23] === 0x88
      && bytecode[24] === 0xac
    ) {
      const hash = bytecode.slice(3, 23);
      const version = network === Network.MAINNET ? 0x00 : 0x6f;
      return { to: encodeBase58AddressFormat(sha256Adapter, version, hash), amount };
    }

    // Unknown script: surface as raw hex so the caller can debug.
    throw new Error(`getTxOutputs: unrecognised locking bytecode 0x${binToHex(bytecode)}`);
  });
}
