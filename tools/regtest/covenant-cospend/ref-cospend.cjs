#!/usr/bin/env node
/*
 * Ref-mechanism CONSENSUS proof (AtomicSwap CRITICAL fix).
 * Deploys MiniRefBuggy (no refOutputCount) and MiniRefFixed
 * (require(tx.inputs.refOutputCount(offerRef) == 1)) as BARE ref-carrying
 * covenants, then co-spends two ref-carrying UTXOs:
 *   buggy -> ACCEPT (two offer carriers drained together = the real exploit)
 *   fixed -> REJECT (OP_REFOUTPUTCOUNT_UTXOS sees 2 != 1)
 */
const cp = require('child_process');
const r = require('/Users/macbookair/CascadeProjects/RadiantMM/node_modules/@radiant-core/radiantjs');
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

function encodeNum(n) { if (n === 0) return Buffer.alloc(0); const o = []; let v = n; while (v > 0) { o.push(v & 0xff); v = Math.floor(v / 256); } if (o[o.length - 1] & 0x80) o.push(0); return Buffer.from(o); }
function outpointRef(txidDisplay, vout) { const t = Buffer.from(txidDisplay, 'hex').reverse(); const v = Buffer.alloc(4); v.writeUInt32LE(vout, 0); return Buffer.concat([t, v]); }
const P2PKH_BURN = Buffer.from('76a914' + '11'.repeat(20) + '88ac', 'hex');

function compileLock(rxdPath, subs) {
  const art = JSON.parse(cp.execFileSync('node', [CASHC, rxdPath, '--covenant-lint=off'], { encoding: 'utf8' }));
  let asm = art.asm;
  for (const [k, v] of Object.entries(subs)) asm = asm.split(k).join(v);
  if (asm.includes('$')) throw new Error('unsubstituted: ' + asm.match(/\$\w+/));
  return Buffer.from(Script.fromASM(asm).toBuffer());
}

// deploy n ref-carrying UTXOs; offerRef = the spent funding coin's outpoint (ref induction)
function deployRef(rxdPath, ownerPubHex, value, n) {
  const O = JSON.parse(rcli('listunspent', '1', '9999999')).filter(x => x.amount >= 2).sort((a, b) => b.amount - a.amount)[0];
  const offerRef = outpointRef(O.txid, O.vout);
  const lock = compileLock(rxdPath, { '$offerRef': toHex(offerRef), '$owner': ownerPubHex });
  const priv = PrivateKey.fromWIF(rcli('dumpprivkey', O.address));
  const tx = new Transaction().from({ txId: O.txid, outputIndex: O.vout, script: O.scriptPubKey, satoshis: Math.round(O.amount * 1e8) });
  for (let i = 0; i < n; i++) tx.addOutput(new Transaction.Output({ script: Script.fromBuffer(lock), satoshis: value }));
  tx.to(rcli('getnewaddress'), Math.round(O.amount * 1e8) - value * n - 5_000_000);
  tx.sign(priv);
  let txid;
  try { txid = rcli('sendrawtransaction', tx.serialize(true)); }
  catch (e) { throw new Error('deploy failed: ' + (e.stderr || e.message)); }
  rcli('generatetoaddress', '1', rcli('getnewaddress'));
  return { coins: Array.from({ length: n }, (_, i) => ({ txid, vout: i, value })), lock, offerRef: toHex(offerRef) };
}

function spend(coins, lock, ownerPriv, outValue, feeArg) {
  const tx = new Transaction();
  for (const c of coins) tx.from({ txId: c.txid, outputIndex: c.vout, script: toHex(lock), satoshis: c.value });
  tx.addOutput(new Transaction.Output({ script: Script.fromBuffer(P2PKH_BURN), satoshis: outValue }));
  coins.forEach((c, i) => {
    const sig = Sighash.sign(tx, ownerPriv, SIGHASH, i, Script.fromBuffer(lock), new BN(c.value), FLAGS);
    const ss = new Script(); ss.add(Buffer.concat([sig.toDER(), Buffer.from([SIGHASH])])); ss.add(encodeNum(feeArg));
    tx.inputs[i].setScript(ss);
  });
  return tx.serialize(true);
}
function bc(label, hex) {
  try { const t = rcli('sendrawtransaction', hex); console.log(`  [ACCEPT] ${label} -> ${t.slice(0, 16)}…`); return true; }
  catch (e) { console.log(`  [REJECT] ${label} -> ${(e.stderr || e.message).toString().split('\n').filter(Boolean).pop()}`); return false; }
}

(function main() {
  const ownerPriv = PrivateKey.fromWIF(rcli('dumpprivkey', rcli('getnewaddress')));
  const ownerPubHex = toHex(ownerPriv.toPublicKey().toBuffer());
  const V = 60_000_000, FEEARG = 30_000_000, OUT = V - FEEARG;
  const res = {};
  for (const variant of ['Buggy', 'Fixed']) {
    console.log(`\n=== MiniRef${variant} (ref-carrying covenant) ===`);
    const legitDep = deployRef(`/tmp/covrt/MiniRef${variant}.rxd`, ownerPubHex, V, 1);
    console.log(`  lock ${legitDep.lock.length}B, offerRef=${legitDep.offerRef.slice(0, 16)}… (1 carrier)`);
    const legit = bc(`${variant} legit (1 ref input)`, spend(legitDep.coins, legitDep.lock, ownerPriv, OUT, FEEARG));
    rcli('generatetoaddress', '1', rcli('getnewaddress'));
    const dep2 = deployRef(`/tmp/covrt/MiniRef${variant}.rxd`, ownerPubHex, V, 2); // 2 carriers, same ref
    const co = bc(`${variant} CO-SPEND (2 ref inputs, refOutputCount=2)`, spend(dep2.coins, dep2.lock, ownerPriv, OUT, FEEARG));
    res[variant] = { legit, co };
  }
  console.log('\n=== CONSENSUS VERDICT (ref mechanism) ===');
  console.log('  Buggy: legit', res.Buggy.legit ? 'ACCEPT✓' : '✗', '| co-spend', res.Buggy.co ? 'ACCEPT (drain real on-chain)✓' : 'REJECT');
  console.log('  Fixed: legit', res.Fixed.legit ? 'ACCEPT✓' : '✗', '| co-spend', res.Fixed.co ? 'ACCEPT✗ FIX FAILED' : 'REJECT (refOutputCount fix holds)✓');
  const pass = res.Buggy.legit && res.Buggy.co && res.Fixed.legit && !res.Fixed.co;
  console.log(`\n  ${pass ? '✅ PROOF: refOutputCount(offerRef)==1 rejects the 2-offer co-spend at consensus.' : '❌ inconclusive'}`);
  process.exit(pass ? 0 : 1);
})();
