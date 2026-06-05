import { hexToBin } from '@bitauth/libauth';
import { placeholder } from '@radiantscript/utils';
import { Contract, ElectrumNetworkProvider, SignatureTemplate } from '../src/index.js';
import { Network, Utxo } from '../src/interfaces.js';
import NetworkProvider from '../src/network/NetworkProvider.js';
import {
  alicePkh,
  alicePk,
  alice,
  bob,
} from './fixture/vars.js';

describe('Contract', () => {
  describe('new', () => {
    it('should fail with incorrect constructor args', () => {
      // eslint-disable-next-line global-require
      const artifact = require('./fixture/p2pkh.json');
      const provider = new ElectrumNetworkProvider();

      expect(() => new Contract(artifact, [], provider)).toThrow();
      expect(() => new Contract(artifact, [20], provider)).toThrow();
      expect(
        () => new Contract(artifact, [placeholder(20), placeholder(20)], provider),
      ).toThrow();
      expect(() => new Contract(artifact, [placeholder(19)], provider)).toThrow();
      expect(() => new Contract(artifact, [placeholder(21)], provider)).toThrow();
    });

    it('should fail with incomplete artifact', () => {
      // eslint-disable-next-line global-require
      const artifact = require('./fixture/p2pkh.json');
      const provider = new ElectrumNetworkProvider();

      expect(() => new Contract({ ...artifact, abi: undefined }, [], provider)).toThrow();
      expect(() => new Contract({ ...artifact, bytecode: undefined }, [], provider)).toThrow();
      expect(
        () => new Contract({ ...artifact, constructorInputs: undefined }, [], provider),
      ).toThrow();
      expect(() => new Contract({ ...artifact, contract: undefined }, [], provider)).toThrow();
    });

    it('should create new P2PKH instance', () => {
      // eslint-disable-next-line global-require
      const artifact = require('./fixture/p2pkh.json');
      const provider = new ElectrumNetworkProvider();
      const instance = new Contract(artifact, [placeholder(20)], provider);

      expect(typeof instance.address).toBe('string');
      expect(typeof instance.functions.spend).toBe('function');
      expect(instance.name).toEqual(artifact.contract);
    });

    it('should create new TransferWithTimeout instance', () => {
      // eslint-disable-next-line global-require
      const artifact = require('./fixture/transfer_with_timeout.json');
      const provider = new ElectrumNetworkProvider();
      const constructorArgs = [placeholder(65), placeholder(65), 1000000];
      const instance = new Contract(artifact, constructorArgs, provider);

      expect(typeof instance.address).toBe('string');
      expect(typeof instance.functions.transfer).toBe('function');
      expect(typeof instance.functions.timeout).toBe('function');
      expect(instance.name).toEqual(artifact.contract);
    });

    it('should create new HodlVault instance', () => {
      // eslint-disable-next-line global-require
      const artifact = require('./fixture/hodl_vault.json');
      const provider = new ElectrumNetworkProvider();
      const constructorArgs = [placeholder(65), placeholder(65), 1000000, 10000];
      const instance = new Contract(artifact, constructorArgs, provider);

      expect(typeof instance.address).toBe('string');
      expect(typeof instance.functions.spend).toBe('function');
      expect(instance.name).toEqual(artifact.contract);
    });

    it('should create new Mecenas instance', () => {
      // eslint-disable-next-line global-require
      const artifact = require('./fixture/mecenas.json');
      const provider = new ElectrumNetworkProvider();
      const constructorArgs = [placeholder(20), placeholder(20), 1000000];
      const instance = new Contract(artifact, constructorArgs, provider);

      expect(typeof instance.address).toBe('string');
      expect(typeof instance.functions.receive).toBe('function');
      expect(typeof instance.functions.reclaim).toBe('function');
      expect(instance.name).toEqual(artifact.contract);
    });
  });

  // NOTE: getBalance tests moved to test/e2e/Contract.balance.e2e.test.ts —
  // both hit a live Radiant ElectrumX endpoint and depend on real funds.

  describe('Contract functions', () => {
    let instance: Contract;
    let bbInstance: Contract;
    beforeEach(() => {
      // eslint-disable-next-line global-require
      const artifact = require('./fixture/p2pkh.json');
      const provider = new ElectrumNetworkProvider();
      instance = new Contract(artifact, [alicePkh], provider);

      // eslint-disable-next-line global-require
      const bbArtifact = require('./fixture/bounded_bytes.json');
      bbInstance = new Contract(bbArtifact, [], provider);
    });

    it('can\'t call spend with incorrect signature', () => {
      expect(() => instance.functions.spend()).toThrow();
      expect(() => instance.functions.spend(0, 1)).toThrow();
      expect(() => instance.functions.spend(alicePk, new SignatureTemplate(alice), 0)).toThrow();
      expect(() => bbInstance.functions.spend(hexToBin('e803'), 1000)).toThrow();
      expect(() => bbInstance.functions.spend(hexToBin('e803000000'), 1000)).toThrow();
    });

    it('can call spend with incorrect arguments', () => {
      expect(() => instance.functions.spend(alicePk, new SignatureTemplate(bob))).not.toThrow();
      expect(() => instance.functions.spend(alicePk, placeholder(65))).not.toThrow();
      expect(() => bbInstance.functions.spend(hexToBin('e8031234'), 1000)).not.toThrow();
    });

    it('can call spend with correct arguments', () => {
      expect(() => instance.functions.spend(alicePk, new SignatureTemplate(alice))).not.toThrow();
      expect(() => bbInstance.functions.spend(hexToBin('e8030000'), 1000)).not.toThrow();
    });
  });

  // L-3: getBalance() must sum UTXO satoshis without precision loss above 2^53.
  describe('getBalance (bigint summation, L-3)', () => {
    // Build a Contract backed by a stub provider that returns the given UTXOs,
    // so we can drive getBalance deterministically without a live endpoint.
    function makeContract(utxos: Utxo[]): Contract {
      // eslint-disable-next-line global-require
      const artifact = require('./fixture/p2pkh.json');
      const stubProvider = {
        network: Network.MAINNET,
        getUtxos: async (): Promise<Utxo[]> => utxos,
        getBlockHeight: async (): Promise<number> => 0,
        getRawTransaction: async (): Promise<string> => '',
        sendRawTransaction: async (): Promise<string> => '',
      } as unknown as NetworkProvider;
      return new Contract(artifact, [alicePkh], stubProvider);
    }

    const utxo = (satoshis: number, n: number): Utxo => ({
      txid: n.toString(16).padStart(64, '0'),
      vout: 0,
      satoshis,
    });

    it('sums small balances correctly', async () => {
      const c = makeContract([utxo(1000, 1), utxo(2500, 2), utxo(500, 3)]);
      expect(await c.getBalance()).toBe(4000);
    });

    it('returns 0 for an empty UTXO set', async () => {
      expect(await makeContract([]).getBalance()).toBe(0);
    });

    it('throws (rather than silently rounding) when the total exceeds 2^53', async () => {
      // Two UTXOs that individually fit in a safe integer but together overflow
      // it; summed in bigint the overflow is detected and surfaced.
      const half = Number.MAX_SAFE_INTEGER;
      const c = makeContract([utxo(half, 1), utxo(half, 2)]);
      await expect(c.getBalance()).rejects.toThrow(/MAX_SAFE_INTEGER/);
    });
  });
});
