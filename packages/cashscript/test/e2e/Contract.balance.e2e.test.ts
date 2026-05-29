// End-to-end tests for `Contract.getBalance()`. These require a live
// connection to a Radiant ElectrumX endpoint (default mainnet, or the
// override set via the constructor). They are excluded from the unit
// suite so the offline pipeline stays deterministic.
//
// To run locally:
//   npx jest --config=../../jest.config.js test/e2e/Contract.balance.e2e.test.ts

import { placeholder } from '@radiantscript/utils';
import { Contract, ElectrumNetworkProvider } from '../../src/index.js';
import { alicePkh } from '../fixture/vars.js';

describe('Contract.getBalance (e2e)', () => {
  // Not very robust, as this depends on the example P2PKH contract having balance
  it('should return balance for existing contract', async () => {
    // eslint-disable-next-line global-require
    const artifact = require('../fixture/p2pkh.json');
    const provider = new ElectrumNetworkProvider();
    const instance = new Contract(artifact, [alicePkh], provider);

    expect(await instance.getBalance()).toBeGreaterThan(0);
  });

  it('should return zero balance for new contract', async () => {
    // eslint-disable-next-line global-require
    const artifact = require('../fixture/p2pkh.json');
    const provider = new ElectrumNetworkProvider();
    const instance = new Contract(artifact, [placeholder(20)], provider);

    expect(await instance.getBalance()).toBe(0);
  });
});
