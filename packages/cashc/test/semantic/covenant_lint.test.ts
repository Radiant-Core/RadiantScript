/*   covenant_lint.test.ts
 *
 * Tests for the heuristic covenant-lint pass (P1). Each of the five diagnostics
 * has:
 *   - a fixture that TRIGGERS it (assert the rule fires),
 *   - at least one well-constrained contract that does NOT trigger it.
 * Plus: a suppression-directive test and an 'error'-mode test.
 *
 * See packages/cashc/src/semantic/CovenantLintTraversal.ts.
 */

import { compileString } from '../../src/index.js';
import { CovenantLintError } from '../../src/Errors.js';
import { Artifact, LintWarning } from '@radiantscript/utils';

function lint(code: string): LintWarning[] {
  const artifact = compileString(code) as Artifact;
  return artifact.warnings ?? [];
}

function rules(warnings: LintWarning[]): string[] {
  return warnings.map((w) => w.rule);
}

describe('Covenant lint pass', () => {
  describe('unconstrained-outputs', () => {
    const triggering = `
pragma radiantscript ^1.0.0;
contract Vault() {
  return {
    spend() {
      require(tx.outputs[0].value == 1000);
    }
  };
}
`;

    const constrained = `
pragma radiantscript ^1.0.0;
contract Vault() {
  return {
    spend() {
      require(tx.outputs.length == 1);
      require(tx.outputs[0].value == 1000);
    }
  };
}
`;

    it('fires when an output is introspected but tx.outputs.length is not constrained', () => {
      expect(rules(lint(triggering))).toContain('unconstrained-outputs');
    });

    it('does not fire when tx.outputs.length is constrained', () => {
      expect(rules(lint(constrained))).not.toContain('unconstrained-outputs');
    });
  });

  describe('dead-computed-value', () => {
    // The classic StatefulCounter footgun: the state var is incremented but the
    // new value is never read again / bound, so the state transition is never
    // enforced. (A fully-unreferenced local is already a hard UnusedVariableError,
    // so the catchable case is a dead *last write*.)
    const triggering = `
pragma radiantscript ^1.0.0;
contract StatefulCounter(bytes36 REF)
function (int count) {
  pushInputRef(REF);
  count = count + 1;
  require(tx.version == 2);
}
`;

    const clean = `
pragma radiantscript ^1.0.0;
contract StatefulCounter(bytes36 REF)
function (int count) {
  pushInputRef(REF);
  count = count + 1;
  require(count == 5);
}
`;

    it('fires when a computed state transition is never subsequently read', () => {
      const warnings = lint(triggering);
      expect(rules(warnings)).toContain('dead-computed-value');
      expect(warnings.find((w) => w.rule === 'dead-computed-value')?.message).toContain('count');
    });

    it('does not fire when the computed value is read after the write', () => {
      expect(rules(lint(clean))).not.toContain('dead-computed-value');
    });
  });

  describe('aggregate-only', () => {
    const triggering = `
pragma radiantscript ^1.0.0;
contract Token(bytes36 REF) {
  return {
    spend() {
      bytes36 ref = pushInputRef(REF);
      require(tx.outputs.refOutputCount(ref) == 1);
    }
  };
}
`;

    const pinned = `
pragma radiantscript ^1.0.0;
contract Token(bytes36 REF) {
  return {
    spend() {
      bytes36 ref = pushInputRef(REF);
      require(tx.outputs.length == 1);
      require(tx.outputs.refOutputCount(ref) == 1);
      require(tx.outputs[0].value == 1000);
    }
  };
}
`;

    it('fires when an aggregate is checked but no specific output is pinned', () => {
      expect(rules(lint(triggering))).toContain('aggregate-only');
    });

    it('does not fire when a specific output field is pinned', () => {
      expect(rules(lint(pinned))).not.toContain('aggregate-only');
    });
  });

  describe('missing-continuity', () => {
    const triggering = `
pragma radiantscript ^1.0.0;
contract SelfRef() {
  return {
    spend() {
      bytes32 csh = hash256(this.activeBytecode);
      require(csh == 0x0000000000000000000000000000000000000000000000000000000000000000);
    }
  };
}
`;

    const continued = `
pragma radiantscript ^1.0.0;
contract SelfRef() {
  return {
    spend() {
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.codeScriptCount(csh) == 1);
    }
  };
}
`;

    it('fires when the covenant reads its own code script but never asserts codeScriptCount', () => {
      expect(rules(lint(triggering))).toContain('missing-continuity');
    });

    it('does not fire when codeScriptCount is asserted', () => {
      expect(rules(lint(continued))).not.toContain('missing-continuity');
    });
  });

  describe('auth-only-spend', () => {
    const triggering = `
pragma radiantscript ^1.0.0;
contract P2PKH(bytes20 pkh) {
  return {
    spend(sig s, pubkey pk) {
      require(hash160(pk) == pkh);
      require(checkSig(s, pk));
    }
  };
}
`;

    const constrained = `
pragma radiantscript ^1.0.0;
contract SignedCovenant(bytes20 pkh) {
  return {
    spend(sig s, pubkey pk) {
      require(hash160(pk) == pkh);
      require(checkSig(s, pk));
      require(tx.outputs.length == 1);
      require(tx.outputs[0].value == 1000);
    }
  };
}
`;

    it('fires when a signature is checked but nothing about the tx shape is', () => {
      expect(rules(lint(triggering))).toContain('auth-only-spend');
    });

    it('does not fire when outputs are also constrained', () => {
      expect(rules(lint(constrained))).not.toContain('auth-only-spend');
    });
  });

  describe('no false positives on well-formed covenant', () => {
    // A tight covenant: pins the output set size, pins a specific output, ties
    // the ref aggregate to that output, asserts code-script continuity, AND
    // conserves value (codeScriptValueSum in == out) — without the conservation
    // relation it would (correctly) trip missing-value-conservation.
    const tight = `
pragma radiantscript ^1.0.0;
contract Tight(bytes36 REF) {
  return {
    spend() {
      bytes36 ref = pushInputRef(REF);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.length == 1);
      require(tx.outputs[0].value == 1000);
      require(tx.outputs.refOutputCount(ref) == 1);
      require(tx.outputs.codeScriptCount(csh) == 1);
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
    }
  };
}
`;

    it('emits no warnings', () => {
      expect(lint(tight)).toHaveLength(0);
    });
  });

  describe('suppression directives', () => {
    it('// covenant-lint-disable silences the whole file', () => {
      const code = `
pragma radiantscript ^1.0.0;
// covenant-lint-disable
contract Vault() {
  return {
    spend() {
      require(tx.outputs[0].value == 1000);
    }
  };
}
`;
      expect(lint(code)).toHaveLength(0);
    });

    it('// covenant-lint-disable-next-line <rule> silences that rule on the next line', () => {
      const code = `
pragma radiantscript ^1.0.0;
contract Vault() {
  return {
    spend() {
      // covenant-lint-disable-next-line unconstrained-outputs
      require(tx.outputs[0].value == 1000);
    }
  };
}
`;
      expect(rules(lint(code))).not.toContain('unconstrained-outputs');
    });

    it('a named directive does not silence a different rule', () => {
      const code = `
pragma radiantscript ^1.0.0;
contract StatefulCounter(bytes36 REF)
function (int count) {
  pushInputRef(REF);
  // covenant-lint-disable-next-line unconstrained-outputs
  count = count + 1;
  require(tx.version == 2);
}
`;
      // dead-computed-value is on the suppressed line but the directive only
      // names unconstrained-outputs, so it must still fire.
      expect(rules(lint(code))).toContain('dead-computed-value');
    });
  });

  describe('compile modes', () => {
    const footgun = `
pragma radiantscript ^1.0.0;
contract Vault() {
  return {
    spend() {
      require(tx.outputs[0].value == 1000);
    }
  };
}
`;

    it("'warn' mode (default) still compiles successfully", () => {
      expect(() => compileString(footgun)).not.toThrow();
      const artifact = compileString(footgun, { covenantLint: 'warn' });
      expect(artifact.warnings && artifact.warnings.length).toBeGreaterThan(0);
    });

    it("'off' mode attaches no warnings", () => {
      const artifact = compileString(footgun, { covenantLint: 'off' });
      expect(artifact.warnings).toBeUndefined();
    });

    it("'error' mode throws CovenantLintError listing the warnings", () => {
      expect(() => compileString(footgun, { covenantLint: 'error' })).toThrow(CovenantLintError);
    });

    it("'error' mode does NOT throw for a well-formed covenant", () => {
      const tight = `
pragma radiantscript ^1.0.0;
contract Tight(bytes36 REF) {
  return {
    spend() {
      bytes36 ref = pushInputRef(REF);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.length == 1);
      require(tx.outputs[0].value == 1000);
      require(tx.outputs.refOutputCount(ref) == 1);
      require(tx.outputs.codeScriptCount(csh) == 1);
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
    }
  };
}
`;
      expect(() => compileString(tight, { covenantLint: 'error' })).not.toThrow();
    });
  });

  // ===========================================================================
  // Rules added by the FIX-B linter hardening (red-team gaps).
  // ===========================================================================

  describe('missing-value-conservation', () => {
    // fn1_value_leak: pins one recipient but leaves a second output unpinned and
    // never relates input value to output value — the attacker skims to out[1].
    const leak = `
pragma radiantscript ^1.0.0;
contract LeakyVault(bytes20 owner) {
  return {
    spend(sig s, pubkey pk) {
      require(hash160(pk) == owner);
      require(checkSig(s, pk));
      require(tx.outputs.length == 2);
      require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2PKH(owner));
    }
  };
}
`;

    // The same shape WITH a value relation (input == out0 + out1) is sound.
    const conserved = `
pragma radiantscript ^1.0.0;
contract Vault(bytes20 owner) {
  return {
    spend(sig s, pubkey pk) {
      require(hash160(pk) == owner);
      require(checkSig(s, pk));
      require(tx.inputs.length == 1);
      require(tx.outputs.length == 2);
      require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2PKH(owner));
      require(tx.outputs[1].lockingBytecode == new LockingBytecodeP2PKH(owner));
      int inVal = tx.inputs[this.activeInputIndex].value;
      require(tx.outputs[0].value + tx.outputs[1].value == inVal);
    }
  };
}
`;

    // A bounded sweep (length == 1, sole output pinned, no ref carried forward)
    // needs no value relation — the whole value goes to the one pinned recipient.
    const sweep = `
pragma radiantscript ^1.0.0;
contract Recover(bytes20 cold) {
  return {
    spend(sig s, pubkey pk) {
      require(checkSig(s, pk));
      require(tx.outputs.length == 1);
      require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2PKH(cold));
    }
  };
}
`;

    it('fires when outputs/refs are constrained but no value relation exists', () => {
      expect(rules(lint(leak))).toContain('missing-value-conservation');
    });

    it('does not fire when input value is related to output value', () => {
      expect(rules(lint(conserved))).not.toContain('missing-value-conservation');
    });

    it('does not fire on a bounded sweep (every output pinned, no ref forwarded)', () => {
      expect(rules(lint(sweep))).not.toContain('missing-value-conservation');
    });
  });

  describe('per-active-input-conservation', () => {
    // fn6_reentrancy: uses tx.inputs[this.activeInputIndex].value with neither a
    // tx-wide input aggregate nor a tx.inputs.length bound — co-spend skim.
    const reentrant = `
pragma radiantscript ^1.0.0;
contract PerInput(bytes36 REF) {
  return {
    spend() {
      bytes36 ref = pushInputRef(REF);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.length == 1);
      require(tx.outputs[0].value == tx.inputs[this.activeInputIndex].value);
      require(tx.outputs.codeScriptCount(csh) == 1);
      require(tx.outputs.refOutputCount(ref) == 1);
    }
  };
}
`;

    // Fixed Vault: bounds tx.inputs.length == 1, so the co-spend merge is invalid.
    const lengthBounded = `
pragma radiantscript ^1.0.0;
contract Vault(bytes20 r) {
  return {
    pay(int fee) {
      require(tx.inputs.length == 1);
      require(tx.outputs.length == 2);
      require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2PKH(r));
      require(tx.outputs[1].lockingBytecode == tx.inputs[this.activeInputIndex].lockingBytecode);
      int inputValue = tx.inputs[this.activeInputIndex].value;
      require(tx.outputs[0].value + tx.outputs[1].value + fee == inputValue);
    }
  };
}
`;

    // Fixed AtomicSwap: bounds tx.inputs.refOutputCount(...) == 1 (a tx-wide input
    // aggregate), so the per-active-input value read is accounted tx-wide.
    const aggregateBounded = `
pragma radiantscript ^1.0.0;
contract A(bytes36 REF) {
  return {
    spend() {
      bytes36 ref = pushInputRef(REF);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.inputs.refOutputCount(ref) == 1);
      require(tx.outputs.length == 1);
      require(tx.outputs[0].codeScript == tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs[0].value == tx.inputs[this.activeInputIndex].value);
      require(tx.outputs.codeScriptCount(csh) == 1);
      require(tx.outputs.refOutputCount(ref) == 1);
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
    }
  };
}
`;

    it('fires when the active input value is read without an aggregate or length bound', () => {
      expect(rules(lint(reentrant))).toContain('per-active-input-conservation');
    });

    it('does not fire when tx.inputs.length is bounded (fixed Vault)', () => {
      expect(rules(lint(lengthBounded))).not.toContain('per-active-input-conservation');
    });

    it('does not fire when a tx-wide input aggregate is present (fixed AtomicSwap)', () => {
      expect(rules(lint(aggregateBounded))).not.toContain('per-active-input-conservation');
    });
  });

  describe('continuity-count-trivial', () => {
    // fn9_count_zero: codeScriptCount(csh) == 0 — the covenant code script is
    // permitted to vanish while a ref is still carried forward.
    const countZero = `
pragma radiantscript ^1.0.0;
contract CountZero(bytes36 REF) {
  return {
    spend() {
      bytes36 ref = pushInputRef(REF);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.length == 1);
      require(tx.outputs[0].value == 1000);
      require(tx.outputs.refOutputCount(ref) == 1);
      require(tx.outputs.codeScriptCount(csh) == 0);
    }
  };
}
`;

    // A count >= 0 is always true — equally trivial.
    const countGeZero = `
pragma radiantscript ^1.0.0;
contract CountGe(bytes36 REF) {
  return {
    spend() {
      bytes36 ref = pushInputRef(REF);
      require(tx.outputs.length == 1);
      require(tx.outputs[0].value == 1000);
      require(tx.outputs.refOutputCount(ref) >= 0);
    }
  };
}
`;

    // A real continuity check (== 1) is NOT trivial.
    const countOne = `
pragma radiantscript ^1.0.0;
contract CountOne(bytes36 REF) {
  return {
    spend() {
      bytes36 ref = pushInputRef(REF);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.length == 1);
      require(tx.outputs[0].codeScript == tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.refOutputCount(ref) == 1);
      require(tx.outputs.codeScriptCount(csh) == 1);
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
    }
  };
}
`;

    // A deliberate melt: refOutputCount(ref) == 0 retires the ref while value is
    // provably destroyed to an OP_RETURN — the == 0 is intended, not a footgun.
    const melt = `
pragma radiantscript ^1.0.0;
contract Melt(bytes36 REF) {
  return {
    spend(sig s, pubkey pk) {
      require(checkSig(s, pk));
      pushInputRef(REF);
      require(tx.outputs.length == 1);
      require(tx.outputs.refOutputCount(REF) == 0);
      bytes nulldata = new LockingBytecodeNullData([0x00]);
      require(tx.outputs[0].lockingBytecode == nulldata);
    }
  };
}
`;

    it('fires when a count aggregate is compared == 0', () => {
      expect(rules(lint(countZero))).toContain('continuity-count-trivial');
    });

    it('fires when a count aggregate is compared >= 0', () => {
      expect(rules(lint(countGeZero))).toContain('continuity-count-trivial');
    });

    it('does not fire when the count is asserted == 1', () => {
      expect(rules(lint(countOne))).not.toContain('continuity-count-trivial');
    });

    it('does not fire on a deliberate melt (count == 0 with a nulldata destroy)', () => {
      expect(rules(lint(melt))).not.toContain('continuity-count-trivial');
    });
  });

  describe('dead-computed-value strengthening', () => {
    // extra2_launder: count is incremented then only used in a trivially-true
    // guard (count > 0) — never bound to an output, so it is a dead computation.
    const launder = `
pragma radiantscript ^1.0.0;
contract Launder(bytes36 REF)
function (int count) {
  pushInputRef(REF);
  count = count + 1;
  require(count > 0);
  require(tx.version == 2);
}
`;

    // A self-tautology does not rescue a dead computed value.
    const tautology = `
pragma radiantscript ^1.0.0;
contract Tauto(bytes36 REF)
function (int count) {
  pushInputRef(REF);
  count = count + 1;
  require(count == count);
  require(tx.version == 2);
}
`;

    // An equality against a concrete value DOES bind the computed value.
    const pinned = `
pragma radiantscript ^1.0.0;
contract Pinned(bytes36 REF)
function (int count) {
  pushInputRef(REF);
  count = count + 1;
  require(count == 5);
}
`;

    it('fires when a computed value is only used in a trivially-true guard', () => {
      expect(rules(lint(launder))).toContain('dead-computed-value');
    });

    it('fires when a computed value is only used in a self-tautology', () => {
      expect(rules(lint(tautology))).toContain('dead-computed-value');
    });

    it('does not fire when the computed value is pinned by an equality', () => {
      expect(rules(lint(pinned))).not.toContain('dead-computed-value');
    });
  });

  describe('conservation-identity refinement (false-positive fix)', () => {
    // The FungibleToken fan-out: codeScriptCount == refOutputCount AND
    // codeScriptValueSum(in) == codeScriptValueSum(out). With the balanced-identity
    // refinement this lints CLEAN with NO suppression directives.
    const fanOut = `
pragma radiantscript ^1.0.0;
contract FungibleToken(bytes36 tokenRef) {
  return {
    transferMulti(pubkey senderPk, sig s) {
      bytes state = tx.inputs[this.activeInputIndex].stateScript;
      require(state.length == 21);
      require(hash160(senderPk) == bytes20(state.split(1)[1]));
      require(checkSig(s, senderPk));
      pushInputRef(tokenRef);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.codeScriptCount(csh) == tx.outputs.refOutputCount(tokenRef));
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
    }
  };
}
`;

    it('lints clean without any suppression directive', () => {
      expect(lint(fanOut)).toHaveLength(0);
    });

    it('silences both aggregate-only and unconstrained-outputs via the balanced identity', () => {
      const ruleNames = rules(lint(fanOut));
      expect(ruleNames).not.toContain('aggregate-only');
      expect(ruleNames).not.toContain('unconstrained-outputs');
    });
  });

  describe('suppression directive hardening (unknown rule)', () => {
    it('emits a meta-warning for an unknown rule name in a directive', () => {
      const code = `
pragma radiantscript ^1.0.0;
contract Typo() {
  return {
    spend() {
      // covenant-lint-disable-line uncontrained-outputs
      require(tx.outputs[0].value == 1000);
    }
  };
}
`;
      const warnings = lint(code);
      const meta = warnings.find((w) => w.rule === 'unknown-lint-rule');
      expect(meta).toBeDefined();
      expect(meta?.message).toContain('uncontrained-outputs');
      // The typo did NOT suppress the real warning (it stays visible).
      expect(rules(warnings)).toContain('unconstrained-outputs');
    });

    it('does not emit a meta-warning for a correctly-spelled rule name', () => {
      const code = `
pragma radiantscript ^1.0.0;
contract Ok() {
  return {
    spend() {
      require(tx.outputs[0].value == 1000); // covenant-lint-disable-line unconstrained-outputs
    }
  };
}
`;
      const ruleNames = rules(lint(code));
      expect(ruleNames).not.toContain('unknown-lint-rule');
      // and the correctly-named directive DID suppress its TARGETED warning, the
      // co-located unconstrained-outputs (other rules on the line, e.g.
      // missing-value-conservation, still fire — that is the named-directive
      // contract, not a regression).
      expect(ruleNames).not.toContain('unconstrained-outputs');
    });
  });

  // ===========================================================================
  // FIX-D — soundness hardening of the conservation-identity refinement and the
  // count/input-count guards (4 convergence-red-team false negatives).
  // ===========================================================================

  describe('F-1: conservation-identity refinement is key-aware (valueSum)', () => {
    // EXPLOIT: codeScriptValueSum(cshA) == codeScriptValueSum(cshB) with DIFFERENT
    // keys conserves NOTHING about the real value pool, yet the old key-blind
    // refinement treated it as a balanced identity and suppressed
    // missing-value-conservation / aggregate-only / unconstrained-outputs while the
    // covenant's real value pool was unconstrained -> value leak linted clean.
    const mismatchedKeys = `
pragma radiantscript ^1.0.0;
contract LeakMismatch(bytes32 cshA, bytes32 cshB) {
  return {
    spend() {
      require(tx.inputs.codeScriptValueSum(cshA) == tx.outputs.codeScriptValueSum(cshB));
      require(tx.outputs.codeScriptCount(cshA) == 1);
    }
  };
}
`;

    // CONTROL: the SAME pattern with a MATCHED key (csh on both sides) IS a sound
    // conservation identity and stays clean — this is the FungibleToken/StatefulCounter
    // idiom, so the refinement must still apply.
    const matchedKey = `
pragma radiantscript ^1.0.0;
contract ConservedMatched(bytes32 csh) {
  return {
    spend() {
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
      require(tx.outputs.codeScriptCount(csh) == 1);
    }
  };
}
`;

    it('fires missing-value-conservation when the valueSum keys differ', () => {
      expect(rules(lint(mismatchedKeys))).toContain('missing-value-conservation');
    });

    it('no longer suppresses aggregate-only / unconstrained-outputs on mismatched keys', () => {
      const ruleNames = rules(lint(mismatchedKeys));
      expect(ruleNames).toContain('aggregate-only');
      expect(ruleNames).toContain('unconstrained-outputs');
    });

    it('stays clean of value-conservation lints when the keys match', () => {
      const ruleNames = rules(lint(matchedKey));
      expect(ruleNames).not.toContain('missing-value-conservation');
    });
  });

  describe('F-2: count stitch clears carrier lints but NOT value conservation', () => {
    // EXPLOIT: a codeScriptCount(csh) == refOutputCount(ref) carrier stitch alone
    // says NOTHING about value, so it must NOT clear missing-value-conservation. The
    // old code happened to satisfy this, but we lock the behaviour with a test: a
    // count-stitch-only covenant (no value identity) must FIRE value conservation.
    const stitchOnly = `
pragma radiantscript ^1.0.0;
contract StitchOnly(bytes36 tokenRef) {
  return {
    transferMulti(pubkey senderPk, sig s) {
      require(checkSig(s, senderPk));
      pushInputRef(tokenRef);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.codeScriptCount(csh) == tx.outputs.refOutputCount(tokenRef));
    }
  };
}
`;

    // CONTROL: the full FungibleToken fan-out — the count stitch (different
    // kinds/keys) clears aggregate-only/unconstrained-outputs, AND a matched-key
    // valueSum identity supplies value conservation — so it lints clean.
    const fullStitchPlusValue = `
pragma radiantscript ^1.0.0;
contract FT(bytes36 tokenRef) {
  return {
    transferMulti(pubkey senderPk, sig s) {
      require(checkSig(s, senderPk));
      pushInputRef(tokenRef);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.codeScriptCount(csh) == tx.outputs.refOutputCount(tokenRef));
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
    }
  };
}
`;

    it('count-stitch-only fires missing-value-conservation', () => {
      const ruleNames = rules(lint(stitchOnly));
      expect(ruleNames).toContain('missing-value-conservation');
      // but the count stitch DOES clear the carrier lints.
      expect(ruleNames).not.toContain('aggregate-only');
      expect(ruleNames).not.toContain('unconstrained-outputs');
    });

    it('count stitch + matched-key valueSum lints fully clean', () => {
      expect(lint(fullStitchPlusValue)).toHaveLength(0);
    });
  });

  describe('F-3: continuity-count-trivial catches non-canonical vacuous forms', () => {
    // A count aggregate is consensus-non-negative, so `< 1`, `<= 0`, `> -1`, `>= 0`,
    // `!= -1` (and == 0) all carry nothing forward / are always true. Each is built
    // on the sound countOne shape (which has a value identity) so the ONLY footgun
    // under test is the continuity comparison itself.
    const make = (op: string): string => `
pragma radiantscript ^1.0.0;
contract C(bytes36 REF) {
  return {
    spend() {
      bytes36 ref = pushInputRef(REF);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.length == 1);
      require(tx.outputs[0].codeScript == tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.refOutputCount(ref) == 1);
      require(tx.outputs.codeScriptCount(csh) ${op});
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
    }
  };
}
`;

    it.each(['< 1', '<= 0', '> -1', '>= 0', '!= -1', '== 0'])(
      'fires continuity-count-trivial on `count %s`',
      (op) => {
        expect(rules(lint(make(op)))).toContain('continuity-count-trivial');
      },
    );

    it.each(['== 1', '>= 1', '> 0'])(
      'stays clean on the sound continuity `count %s`',
      (op) => {
        expect(rules(lint(make(op)))).not.toContain('continuity-count-trivial');
      },
    );

    it('also handles the mirrored literal-on-left form (`1 > count` == `< 1`)', () => {
      const mirrored = `
pragma radiantscript ^1.0.0;
contract C(bytes36 REF) {
  return {
    spend() {
      bytes36 ref = pushInputRef(REF);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.length == 1);
      require(tx.outputs[0].codeScript == tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.refOutputCount(ref) == 1);
      require(1 > tx.outputs.codeScriptCount(csh));
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
    }
  };
}
`;
      expect(rules(lint(mirrored))).toContain('continuity-count-trivial');
    });
  });

  describe('F-4: per-active-input conservation ignores a vacuous inputs.length guard', () => {
    // Only a bound that FORBIDS the 2-input co-spend (== 1, <= 1, < 2) defeats the
    // footgun. A vacuous `tx.inputs.length >= 1` (always true) must NOT clear it.
    const make = (guard: string): string => `
pragma radiantscript ^1.0.0;
contract Vault(bytes20 r) {
  return {
    pay(int fee) {
      require(${guard});
      require(tx.outputs.length == 2);
      require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2PKH(r));
      require(tx.outputs[1].lockingBytecode == tx.inputs[this.activeInputIndex].lockingBytecode);
      int inputValue = tx.inputs[this.activeInputIndex].value;
      require(tx.outputs[0].value + tx.outputs[1].value + fee == inputValue);
    }
  };
}
`;

    it.each([
      'tx.inputs.length >= 1',
      'tx.inputs.length > 0',
      'tx.inputs.length != 0',
      'tx.inputs.length >= 2',
      'tx.inputs.length == 3',
    ])('fires per-active-input-conservation on the non-forbidding guard `%s`', (guard) => {
      expect(rules(lint(make(guard)))).toContain('per-active-input-conservation');
    });

    it.each([
      'tx.inputs.length == 1',
      'tx.inputs.length <= 1',
      'tx.inputs.length < 2',
      '1 == tx.inputs.length',
      '2 > tx.inputs.length',
    ])('stays clean on the real anti-merge bound `%s`', (guard) => {
      expect(rules(lint(make(guard)))).not.toContain('per-active-input-conservation');
    });
  });

  // ===========================================================================
  // FIX-E — two HIGH false-negatives a red-team found:
  //   L-1 state-bound-to-noncarrier : next state bound to a DIFFERENT output index
  //                                   than the pinned continuity carrier.
  //   L-2 forwarded-ref-uncontained : a forwarded (non-singleton) ref whose output
  //                                   containment is never pinned (foreign-script
  //                                   escape via the subset push-ref rule).
  // ===========================================================================

  describe('state-bound-to-noncarrier (L-1)', () => {
    // EXPLOIT: pins code/value/ref continuity to output[0] but binds the next state
    // to output[1] — the real carrier (output[0]) has its state UNCONSTRAINED while
    // a non-carrier output's state is bound, so an attacker forwards an arbitrary
    // (e.g. owner-spoofing) state on output[0].
    const wrongIndex = `
pragma radiantscript ^1.1.0;
contract T(bytes36 tokenRef) {
  return {
    transfer(pubkey senderPk, sig s, bytes20 newOwnerPkh) {
      require(checkSig(s, senderPk));
      pushInputRef(tokenRef);
      require(tx.outputs.length == 1);
      bytes myCode = tx.inputs[this.activeInputIndex].codeScript;
      bytes32 csh = hash256(myCode);
      require(tx.outputs.refOutputCount(tokenRef) == 1);
      require(tx.outputs.codeScriptCount(csh) == 1);
      require(tx.outputs[0].codeScript == myCode);
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
      require(tx.outputs[1].stateScript == 0x14 + newOwnerPkh);
    }
  };
}
`;

    // CONTROL (the real SingletonNFT/FungibleToken/StatefulCounter pattern): the
    // next state is bound to the SAME output index the continuity is pinned to
    // (output[0]) — clean.
    const sameIndex = `
pragma radiantscript ^1.1.0;
contract T(bytes36 tokenRef) {
  return {
    transfer(pubkey senderPk, sig s, bytes20 newOwnerPkh) {
      require(checkSig(s, senderPk));
      pushInputRef(tokenRef);
      require(tx.outputs.length == 1);
      bytes myCode = tx.inputs[this.activeInputIndex].codeScript;
      bytes32 csh = hash256(myCode);
      require(tx.outputs.refOutputCount(tokenRef) == 1);
      require(tx.outputs.codeScriptCount(csh) == 1);
      require(tx.outputs[0].codeScript == myCode);
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
      require(tx.outputs[0].stateScript == 0x14 + newOwnerPkh);
    }
  };
}
`;

    it('fires when the next state is bound to a non-carrier output index', () => {
      const warnings = lint(wrongIndex);
      expect(rules(warnings)).toContain('state-bound-to-noncarrier');
      const msg = warnings.find((w) => w.rule === 'state-bound-to-noncarrier')?.message;
      expect(msg).toContain('output[0]');
      expect(msg).toContain('output[1]');
    });

    it('does not fire when the state is bound to the same index as the carrier', () => {
      expect(rules(lint(sameIndex))).not.toContain('state-bound-to-noncarrier');
    });
  });

  describe('forwarded-ref-uncontained (L-2)', () => {
    // EXPLOIT: forwards $tokenRef via pushInputRef and pins codeScriptCount, but
    // NEVER constrains the ref's output containment (no refOutputCount(ref) and no
    // codeScriptCount == refOutputCount stitch). The subset push-ref rule lets the
    // ref be split into an extra foreign (rule-free) script.
    const uncontained = `
pragma radiantscript ^1.1.0;
contract T2(bytes36 tokenRef) {
  return {
    transfer(pubkey senderPk, sig s) {
      require(checkSig(s, senderPk));
      bytes r = pushInputRef(tokenRef);
      require(r != 0x0);
      require(tx.outputs.length == 1);
      bytes myCode = tx.inputs[this.activeInputIndex].codeScript;
      bytes32 csh = hash256(myCode);
      require(tx.outputs.codeScriptCount(csh) == 1);
      require(tx.outputs[0].codeScript == myCode);
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
    }
  };
}
`;

    // CONTROL A (FungibleToken.transfer): refOutputCount(ref) == 1 contains it.
    const containedByCount = `
pragma radiantscript ^1.1.0;
contract T2(bytes36 tokenRef) {
  return {
    transfer(pubkey senderPk, sig s, bytes20 newOwnerPkh) {
      require(checkSig(s, senderPk));
      pushInputRef(tokenRef);
      require(tx.outputs.length == 1);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.refOutputCount(tokenRef) == 1);
      require(tx.outputs.codeScriptCount(csh) == 1);
      require(tx.outputs[0].codeScript == tx.inputs[this.activeInputIndex].codeScript);
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
      require(tx.outputs[0].stateScript == 0x14 + newOwnerPkh);
    }
  };
}
`;

    // CONTROL B (FungibleToken.transferMulti): the count stitch
    // codeScriptCount == refOutputCount(ref) contains the ref.
    const containedByStitch = `
pragma radiantscript ^1.1.0;
contract T2(bytes36 tokenRef) {
  return {
    transferMulti(pubkey senderPk, sig s) {
      require(checkSig(s, senderPk));
      pushInputRef(tokenRef);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.codeScriptCount(csh) == tx.outputs.refOutputCount(tokenRef));
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
    }
  };
}
`;

    // CONTROL C (SingletonNFT.melt): refOutputCount(ref) == 0 retires the ref —
    // the output count IS constrained, so it stays clean.
    const meltContained = `
pragma radiantscript ^1.1.0;
contract T2(bytes36 tokenRef) {
  return {
    melt(pubkey ownerPk, sig s) {
      require(checkSig(s, ownerPk));
      pushInputRef(tokenRef);
      require(tx.outputs.length == 1);
      require(tx.outputs.refOutputCount(tokenRef) == 0);
      bytes nulldata = new LockingBytecodeNullData([0x00]);
      require(tx.outputs[0].lockingBytecode == nulldata);
    }
  };
}
`;

    // CONTROL D (SingletonNFT.transfer): a SINGLETON forward is consensus-unique
    // and exempt — it must NOT fire even though no refOutputCount is asserted here.
    const singletonExempt = `
pragma radiantscript ^1.1.0;
contract T2(bytes36 nftRef) {
  return {
    transfer(pubkey ownerPk, sig s) {
      require(checkSig(s, ownerPk));
      pushInputRefSingleton(nftRef);
      require(tx.outputs.length == 1);
      bytes32 csh = hash256(tx.inputs[this.activeInputIndex].codeScript);
      require(tx.outputs.codeScriptCount(csh) == 1);
      require(tx.outputs[0].codeScript == tx.inputs[this.activeInputIndex].codeScript);
      require(tx.inputs.codeScriptValueSum(csh) == tx.outputs.codeScriptValueSum(csh));
    }
  };
}
`;

    it('fires when a forwarded ref has no output-containment pin', () => {
      expect(rules(lint(uncontained))).toContain('forwarded-ref-uncontained');
    });

    it('does not fire when refOutputCount(ref) is constrained (== 1)', () => {
      expect(rules(lint(containedByCount))).not.toContain('forwarded-ref-uncontained');
    });

    it('does not fire when a codeScriptCount == refOutputCount(ref) stitch is present', () => {
      expect(rules(lint(containedByStitch))).not.toContain('forwarded-ref-uncontained');
    });

    it('does not fire on a melt (refOutputCount(ref) == 0 still constrains it)', () => {
      expect(rules(lint(meltContained))).not.toContain('forwarded-ref-uncontained');
    });

    it('does not fire on a singleton forward (consensus-unique, exempt)', () => {
      expect(rules(lint(singletonExempt))).not.toContain('forwarded-ref-uncontained');
    });
  });
});
