#!/usr/bin/env node
/*
 * Covenant co-spend CONSENSUS proof on regtest.
 * Deploys MiniVaultBuggy (no inputs.length bound) and MiniVaultFixed
 * (require(tx.inputs.length == 1)) as BARE covenants, then for each:
 *   - legit single-input spend  -> expect ACCEPT
 *   - 2-input co-spend attack    -> buggy: ACCEPT (fee-burn real); fixed: REJECT
 */
const cp = require('child_process');
const path = require('path');
const RJS = '/Users/macbookair/CascadeProjects/RadiantMM/node_modules/@radiant-core/radiantjs';
const r = require(RJS);
const { Transaction, Script, PrivateKey, crypto } = r;
const BN = crypto.BN;
const Sighash = Transaction.Sighash;
const SIGHASH = crypto.Signature.SIGHASH_ALL | crypto.Signature.SIGHASH_FORKID;
const FLAGS = Script.Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID | Script.Interpreter.SCRIPT_VERIFY_STRICTENC;
const RT = '/tmp/cov-regtest';
const CASHC = '/Users/macbookair/CascadeProjects/RadiantScript/packages/cashc/dist/main/cashc-cli.js';
const BIN = '/Users/macbookair/CascadeProjects/Radiant-Core/build/src/radiant-cli';

const rcli = (...a) => cp.execFileSync(BIN, [`-datadir=${RT}`, '-regtest', '-rpcport=18444', '-rpcwallet=cov', ...a], { encoding: 'utf8' }).trim();
const toHex = (b) => Buffer.from(b).toString('hex');

// minimal CScriptNum encoding for a non-negative int
function encodeNum(n) {
  if (n === 0) return Buffer.alloc(0);
  const out = []; let v = n;
  while (v > 0) { out.push(v & 0xff); v = Math.floor(v / 256); }
  if (out[out.length - 1] & 0x80) out.push(0x00);
  return Buffer.from(out);
}

function compileLockingScript(rxdPath, ownerPubHex) {
  const json = cp.execFileSync('node', [CASHC, rxdPath, '--covenant-lint=off'], { encoding: 'utf8' });
  const art = JSON.parse(json);
  let asm = art.asm.split('$owner').join(ownerPubHex);
  if (asm.includes('$')) throw new Error('unsubstituted placeholder: ' + asm.match(/\$\w+/));
  return Buffer.from(Script.fromASM(asm).toBuffer());
}

// fund N outputs of `value` sats each to `lockBuf`, return [{txid,vout,value}...]
function deploy(lockBuf, value, n) {
  const u = JSON.parse(rcli('listunspent', '1', '9999999')).filter(x => x.amount >= 1).sort((a, b) => b.amount - a.amount)[0];
  const wif = rcli('dumpprivkey', u.address);
  const priv = PrivateKey.fromWIF(wif);
  const tx = new Transaction().from({ txId: u.txid, outputIndex: u.vout, script: u.scriptPubKey, satoshis: Math.round(u.amount * 1e8) });
  for (let i = 0; i < n; i++) tx.addOutput(new Transaction.Output({ script: Script.fromBuffer(lockBuf), satoshis: value }));
  const FEE = 5_000_000;
  tx.to(rcli('getnewaddress'), Math.round(u.amount * 1e8) - value * n - FEE);
  tx.sign(priv);
  const txid = rcli('sendrawtransaction', tx.serialize(true));
  rcli('generatetoaddress', '1', rcli('getnewaddress'));
  return Array.from({ length: n }, (_, i) => ({ txid, vout: i, value }));
}

// spend `coins` (all the same covenant lock) to a single output; sign each with ownerPriv; fee arg = feeArg
function spendCovenant(coins, lockBuf, ownerPriv, outValue, feeArg) {
  const tx = new Transaction();
  for (const c of coins) tx.from({ txId: c.txid, outputIndex: c.vout, script: toHex(lockBuf), satoshis: c.value });
  tx.addOutput(new Transaction.Output({ script: Script.fromBuffer(Buffer.from(rcli('getaddressinfo', rcli('getnewaddress')) && '76a914' + '00'.repeat(20) + '88ac', 'hex')), satoshis: outValue }));
  // sign each covenant input; scriptSig = push(sig) push(feeArg)  [order derived from ASM]
  coins.forEach((c, i) => {
    const sig = Sighash.sign(tx, ownerPriv, SIGHASH, i, Script.fromBuffer(lockBuf), new BN(c.value), FLAGS);
    const sigbuf = Buffer.concat([sig.toDER(), Buffer.from([SIGHASH])]);
    const ss = new Script();
    ss.add(sigbuf);
    ss.add(encodeNum(feeArg));
    tx.inputs[i].setScript(ss);
  });
  return tx.serialize(true);
}

function tryBroadcast(label, hex) {
  try { const txid = rcli('sendrawtransaction', hex); console.log(`  [ACCEPT] ${label} -> ${txid.slice(0, 16)}…`); return { ok: true, txid }; }
  catch (e) {
    const msg = (e.stderr || e.message || '').toString().split('\n').filter(Boolean).pop();
    console.log(`  [REJECT] ${label} -> ${msg}`); return { ok: false, msg };
  }
}

(function main() {
  const ownerPriv = PrivateKey.fromWIF(rcli('dumpprivkey', rcli('getnewaddress')));
  const ownerPubHex = toHex(ownerPriv.toPublicKey().toBuffer());
  const V = 60_000_000, FEEARG = 30_000_000, OUT = V - FEEARG; // out0 + fee == V

  const results = {};
  for (const variant of ['Buggy', 'Fixed']) {
    console.log(`\n=== MiniVault${variant} ===`);
    const lock = compileLockingScript(`/tmp/covrt/MiniVault${variant}.rxd`, ownerPubHex);
    console.log(`  lock script: ${lock.length} bytes`);
    const coins = deploy(lock, V, 2);
    // legit single-input spend (input value V, out = V - fee)
    const legit = spendCovenant([coins[0]], lock, ownerPriv, OUT, FEEARG);
    const legitR = tryBroadcast(`${variant} legit (1 input)`, legit);
    rcli('generatetoaddress', '1', rcli('getnewaddress'));
    // co-spend attack: 2 inputs (2V), single out = V - fee  -> miner fee = V + feeArg burned
    const cospend = spendCovenant([coins[1], { ...coins[0] }], lock, ownerPriv, OUT, FEEARG);
    // coins[0] was just spent by legit; use two FRESH coins instead
    const fresh = deploy(lock, V, 2);
    const cospend2 = spendCovenant(fresh, lock, ownerPriv, OUT, FEEARG);
    const coR = tryBroadcast(`${variant} CO-SPEND (2 inputs)`, cospend2);
    results[variant] = { legit: legitR.ok, cospend: coR.ok };
  }

  console.log('\n=== CONSENSUS VERDICT ===');
  console.log('  Buggy: legit', results.Buggy.legit ? 'ACCEPT✓' : 'REJECT✗', '| co-spend', results.Buggy.cospend ? 'ACCEPT (exploit real on-chain)✓' : 'REJECT');
  console.log('  Fixed: legit', results.Fixed.legit ? 'ACCEPT✓' : 'REJECT✗', '| co-spend', results.Fixed.cospend ? 'ACCEPT✗ (FIX FAILED)' : 'REJECT (fix holds at consensus)✓');
  const pass = results.Buggy.legit && results.Buggy.cospend && results.Fixed.legit && !results.Fixed.cospend;
  console.log(`\n  ${pass ? '✅ PROOF COMPLETE: fix rejects the co-spend at consensus; buggy accepts it.' : '❌ inconclusive — see above'}`);
  process.exit(pass ? 0 : 1);
})();
