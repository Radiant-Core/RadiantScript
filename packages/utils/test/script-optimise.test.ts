/*
 * Property-based and boundary tests for the opcode-list optimiser
 * (audit §3.10).
 *
 * What we test:
 *  1. Every rule in OPTIMISATION_RULES is *behaviourally* equivalent
 *     under a minimal opcode interpreter on random starting stacks.
 *  2. Every rule shrinks (or is size-neutral): rhs.length <= lhs.length.
 *  3. The stack-depth 3 / 4 boundary around the codegen's
 *     `removeFinalVerify` + `cleanStack` (audit §4 carry-over): a
 *     manually-constructed script representing each branch optimises to
 *     the same final-stack behaviour as the unoptimised script.
 *  4. Spot checks against opcode-prefix collisions that the legacy
 *     regex pipeline was fragile to.
 *
 * The interpreter is intentionally minimal: it covers only the opcodes
 * mentioned by `cashproof-optimisations.ts` plus the hardcoded
 * post-cashproof rules. Crypto opcodes (CHECKSIG / CHECKDATASIG /
 * CHECKMULTISIG and their VERIFY forms) are modelled as deterministic
 * functions of their inputs rather than real signature checks; rule
 * equivalence only requires the function be deterministic.
 */

import {
  Op,
  OPTIMISATION_RULES,
  optimiseBytecode,
  scriptToAsm,
  Script,
} from '../src/index.js';
import { encodeInt, decodeInt } from '../src/index.js';
import { sha256, ripemd160 } from '../src/hash.js';

// ----------------------------------------------------------------------
// Stack model
// ----------------------------------------------------------------------

// Stack items are bytes; numbers are stored as scriptnum-encoded bytes
// so that OP_EQUAL (byte compare) and OP_NUMEQUAL (number compare) both
// behave correctly. Helpers convert between the two views on demand.
type StackItem = Uint8Array;

function pushNum(stack: StackItem[], n: number | bigint): void {
  stack.push(encodeInt(n));
}

function popNum(stack: StackItem[]): number {
  const top = stack.pop();
  if (top === undefined) throw new Error('stack underflow');
  if (top.length === 0) return 0;
  return decodeInt(top);
}

function popBytes(stack: StackItem[]): Uint8Array {
  const top = stack.pop();
  if (top === undefined) throw new Error('stack underflow');
  return top;
}

function pushBytes(stack: StackItem[], b: Uint8Array): void {
  stack.push(b);
}

function isTruthy(b: Uint8Array): boolean {
  // Bitcoin "truthy": any non-zero byte that is not just a sign bit on
  // an otherwise-zero word.
  if (b.length === 0) return false;
  for (let i = 0; i < b.length; i += 1) {
    if (b[i] !== 0) {
      // Allow the sign byte (0x80) on the last position to make zero
      // negative-zero representations also falsy.
      if (i === b.length - 1 && b[i] === 0x80) return false;
      return true;
    }
  }
  return false;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

// Deterministic stand-in for a signature check. Hashes the concatenation
// of the inputs and returns truthy if the first byte is even. Used by
// OP_CHECKSIG / OP_CHECKDATASIG / OP_CHECKMULTISIG so equivalence rules
// involving them have something deterministic to compare against.
function fakeSigCheck(parts: Uint8Array[]): boolean {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return sha256(buf)[0] % 2 === 0;
}

// ----------------------------------------------------------------------
// Interpreter
// ----------------------------------------------------------------------

interface InterpreterResult {
  stack: StackItem[];
  failed: boolean;
}

function execute(script: Script, initialStack: StackItem[]): InterpreterResult {
  const stack: StackItem[] = initialStack.map((x) => Uint8Array.from(x));
  // Control flow: stack of "executing?" booleans (innermost last).
  const cf: boolean[] = [];
  const executing = (): boolean => cf.every((x) => x);

  try {
    for (let i = 0; i < script.length; i += 1) {
      const op = script[i];

      // Data pushes — only execute when the surrounding branch is live.
      if (op instanceof Uint8Array) {
        if (executing()) pushBytes(stack, op);
        continue;
      }

      // Control flow opcodes evaluate unconditionally so nesting works.
      if (op === Op.OP_IF) {
        if (executing()) {
          const top = popBytes(stack);
          cf.push(isTruthy(top));
        } else {
          cf.push(false);
        }
        continue;
      }
      if (op === Op.OP_NOTIF) {
        if (executing()) {
          const top = popBytes(stack);
          cf.push(!isTruthy(top));
        } else {
          cf.push(false);
        }
        continue;
      }
      if (op === Op.OP_ELSE) {
        if (cf.length === 0) throw new Error('OP_ELSE outside OP_IF');
        cf[cf.length - 1] = !cf[cf.length - 1];
        continue;
      }
      if (op === Op.OP_ENDIF) {
        if (cf.length === 0) throw new Error('OP_ENDIF outside OP_IF');
        cf.pop();
        continue;
      }

      if (!executing()) continue;

      switch (op) {
        // Small-int push opcodes
        case Op.OP_0: pushNum(stack, 0); break;
        case Op.OP_1NEGATE: pushNum(stack, -1); break;
        case Op.OP_1: case Op.OP_2: case Op.OP_3: case Op.OP_4:
        case Op.OP_5: case Op.OP_6: case Op.OP_7: case Op.OP_8:
        case Op.OP_9: case Op.OP_10: case Op.OP_11: case Op.OP_12:
        case Op.OP_13: case Op.OP_14: case Op.OP_15: case Op.OP_16:
          pushNum(stack, op - 0x50);
          break;

        // Arithmetic
        case Op.OP_1ADD: pushNum(stack, popNum(stack) + 1); break;
        case Op.OP_1SUB: pushNum(stack, popNum(stack) - 1); break;
        case Op.OP_NEGATE: pushNum(stack, -popNum(stack)); break;
        case Op.OP_NOT: pushNum(stack, popNum(stack) === 0 ? 1 : 0); break;
        case Op.OP_0NOTEQUAL: pushNum(stack, popNum(stack) !== 0 ? 1 : 0); break;
        case Op.OP_ADD: { const b = popNum(stack); const a = popNum(stack); pushNum(stack, a + b); break; }
        case Op.OP_SUB: { const b = popNum(stack); const a = popNum(stack); pushNum(stack, a - b); break; }
        case Op.OP_MOD: {
          const b = popNum(stack); const a = popNum(stack);
          if (b === 0) throw new Error('div by zero');
          pushNum(stack, a - b * Math.trunc(a / b));
          break;
        }

        // Comparison
        case Op.OP_NUMEQUAL: { const b = popNum(stack); const a = popNum(stack); pushNum(stack, a === b ? 1 : 0); break; }
        case Op.OP_NUMNOTEQUAL: { const b = popNum(stack); const a = popNum(stack); pushNum(stack, a !== b ? 1 : 0); break; }
        case Op.OP_LESSTHAN: { const b = popNum(stack); const a = popNum(stack); pushNum(stack, a < b ? 1 : 0); break; }
        case Op.OP_GREATERTHAN: { const b = popNum(stack); const a = popNum(stack); pushNum(stack, a > b ? 1 : 0); break; }
        case Op.OP_LESSTHANOREQUAL: { const b = popNum(stack); const a = popNum(stack); pushNum(stack, a <= b ? 1 : 0); break; }
        case Op.OP_GREATERTHANOREQUAL: { const b = popNum(stack); const a = popNum(stack); pushNum(stack, a >= b ? 1 : 0); break; }
        case Op.OP_EQUAL: { const b = popBytes(stack); const a = popBytes(stack); pushNum(stack, bytesEqual(a, b) ? 1 : 0); break; }
        case Op.OP_EQUALVERIFY: { const b = popBytes(stack); const a = popBytes(stack); if (!bytesEqual(a, b)) throw new Error('EQUALVERIFY fail'); break; }
        case Op.OP_NUMEQUALVERIFY: { const b = popNum(stack); const a = popNum(stack); if (a !== b) throw new Error('NUMEQUALVERIFY fail'); break; }
        case Op.OP_VERIFY: { const v = popBytes(stack); if (!isTruthy(v)) throw new Error('VERIFY fail'); break; }

        // Hashes
        case Op.OP_SHA256: { const a = popBytes(stack); pushBytes(stack, sha256(a)); break; }
        case Op.OP_RIPEMD160: { const a = popBytes(stack); pushBytes(stack, ripemd160(a)); break; }
        case Op.OP_HASH160: { const a = popBytes(stack); pushBytes(stack, ripemd160(sha256(a))); break; }
        case Op.OP_HASH256: { const a = popBytes(stack); pushBytes(stack, sha256(sha256(a))); break; }

        // Stack
        case Op.OP_DUP: {
          if (stack.length < 1) throw new Error('underflow');
          pushBytes(stack, Uint8Array.from(stack[stack.length - 1]));
          break;
        }
        case Op.OP_DROP: popBytes(stack); break;
        case Op.OP_NIP: {
          if (stack.length < 2) throw new Error('underflow');
          stack.splice(stack.length - 2, 1);
          break;
        }
        case Op.OP_SWAP: {
          if (stack.length < 2) throw new Error('underflow');
          const t = stack[stack.length - 1];
          stack[stack.length - 1] = stack[stack.length - 2];
          stack[stack.length - 2] = t;
          break;
        }
        case Op.OP_ROT: {
          if (stack.length < 3) throw new Error('underflow');
          const x = stack.splice(stack.length - 3, 1)[0];
          stack.push(x);
          break;
        }
        case Op.OP_OVER: {
          if (stack.length < 2) throw new Error('underflow');
          pushBytes(stack, Uint8Array.from(stack[stack.length - 2]));
          break;
        }
        case Op.OP_PICK: {
          const n = popNum(stack);
          if (n < 0 || n >= stack.length) throw new Error('PICK out of range');
          pushBytes(stack, Uint8Array.from(stack[stack.length - 1 - n]));
          break;
        }
        case Op.OP_ROLL: {
          const n = popNum(stack);
          if (n < 0 || n >= stack.length) throw new Error('ROLL out of range');
          const x = stack.splice(stack.length - 1 - n, 1)[0];
          stack.push(x);
          break;
        }
        case Op.OP_2DROP: { popBytes(stack); popBytes(stack); break; }
        case Op.OP_2DUP: {
          if (stack.length < 2) throw new Error('underflow');
          pushBytes(stack, Uint8Array.from(stack[stack.length - 2]));
          pushBytes(stack, Uint8Array.from(stack[stack.length - 2]));
          break;
        }
        case Op.OP_2OVER: {
          if (stack.length < 4) throw new Error('underflow');
          pushBytes(stack, Uint8Array.from(stack[stack.length - 4]));
          pushBytes(stack, Uint8Array.from(stack[stack.length - 4]));
          break;
        }
        case Op.OP_2SWAP: {
          if (stack.length < 4) throw new Error('underflow');
          const a = stack[stack.length - 4];
          const b = stack[stack.length - 3];
          stack[stack.length - 4] = stack[stack.length - 2];
          stack[stack.length - 3] = stack[stack.length - 1];
          stack[stack.length - 2] = a;
          stack[stack.length - 1] = b;
          break;
        }
        case Op.OP_2ROT: {
          if (stack.length < 6) throw new Error('underflow');
          const a = stack.splice(stack.length - 6, 1)[0];
          const b = stack.splice(stack.length - 5, 1)[0];
          stack.push(a, b);
          break;
        }
        case Op.OP_3DUP: {
          if (stack.length < 3) throw new Error('underflow');
          pushBytes(stack, Uint8Array.from(stack[stack.length - 3]));
          pushBytes(stack, Uint8Array.from(stack[stack.length - 3]));
          pushBytes(stack, Uint8Array.from(stack[stack.length - 3]));
          break;
        }

        // Byte ops
        case Op.OP_CAT: {
          const b = popBytes(stack); const a = popBytes(stack);
          const r = new Uint8Array(a.length + b.length);
          r.set(a); r.set(b, a.length);
          pushBytes(stack, r);
          break;
        }
        case Op.OP_AND: {
          const b = popBytes(stack); const a = popBytes(stack);
          if (a.length !== b.length) throw new Error('AND length mismatch');
          const r = new Uint8Array(a.length);
          for (let k = 0; k < a.length; k += 1) r[k] = a[k] & b[k];
          pushBytes(stack, r);
          break;
        }
        case Op.OP_OR: {
          const b = popBytes(stack); const a = popBytes(stack);
          if (a.length !== b.length) throw new Error('OR length mismatch');
          const r = new Uint8Array(a.length);
          for (let k = 0; k < a.length; k += 1) r[k] = a[k] | b[k];
          pushBytes(stack, r);
          break;
        }
        case Op.OP_XOR: {
          const b = popBytes(stack); const a = popBytes(stack);
          if (a.length !== b.length) throw new Error('XOR length mismatch');
          const r = new Uint8Array(a.length);
          for (let k = 0; k < a.length; k += 1) r[k] = a[k] ^ b[k];
          pushBytes(stack, r);
          break;
        }

        // Crypto (deterministic stand-ins)
        case Op.OP_CHECKSIG: { const pk = popBytes(stack); const sig = popBytes(stack); pushNum(stack, fakeSigCheck([sig, pk]) ? 1 : 0); break; }
        case Op.OP_CHECKSIGVERIFY: { const pk = popBytes(stack); const sig = popBytes(stack); if (!fakeSigCheck([sig, pk])) throw new Error('CHECKSIGVERIFY fail'); break; }
        case Op.OP_CHECKDATASIG: { const pk = popBytes(stack); const msg = popBytes(stack); const sig = popBytes(stack); pushNum(stack, fakeSigCheck([sig, msg, pk]) ? 1 : 0); break; }
        case Op.OP_CHECKDATASIGVERIFY: { const pk = popBytes(stack); const msg = popBytes(stack); const sig = popBytes(stack); if (!fakeSigCheck([sig, msg, pk])) throw new Error('CHECKDATASIGVERIFY fail'); break; }
        case Op.OP_CHECKMULTISIG: {
          // Simplified: pop M sigs and N pks plus the trailing zero, model as fakeSigCheck(all).
          // For property testing we just need determinism.
          const nPk = popNum(stack);
          const pks: Uint8Array[] = [];
          for (let k = 0; k < nPk; k += 1) pks.push(popBytes(stack));
          const nSig = popNum(stack);
          const sigs: Uint8Array[] = [];
          for (let k = 0; k < nSig; k += 1) sigs.push(popBytes(stack));
          popBytes(stack); // dummy
          pushNum(stack, fakeSigCheck([...sigs, ...pks]) ? 1 : 0);
          break;
        }
        case Op.OP_CHECKMULTISIGVERIFY: {
          const nPk = popNum(stack);
          const pks: Uint8Array[] = [];
          for (let k = 0; k < nPk; k += 1) pks.push(popBytes(stack));
          const nSig = popNum(stack);
          const sigs: Uint8Array[] = [];
          for (let k = 0; k < nSig; k += 1) sigs.push(popBytes(stack));
          popBytes(stack); // dummy
          if (!fakeSigCheck([...sigs, ...pks])) throw new Error('CHECKMULTISIGVERIFY fail');
          break;
        }

        default:
          throw new Error(`unhandled opcode 0x${(op as number).toString(16)} at index ${i}`);
      }
    }
  } catch (_e) {
    return { stack, failed: true };
  }
  return { stack, failed: false };
}

function stacksEqual(a: StackItem[], b: StackItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!bytesEqual(a[i], b[i])) return false;
  }
  return true;
}

// ----------------------------------------------------------------------
// Random input generator
// ----------------------------------------------------------------------

// Deterministic PRNG so failures reproduce.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomStackItem(rand: () => number): Uint8Array {
  // 60% small-int (script-num), 40% random byte string of equal length (so
  // OP_AND/OR/XOR don't trip the length check) at length 4.
  if (rand() < 0.6) {
    const n = Math.floor(rand() * 20) - 5; // -5..14
    return encodeInt(n);
  }
  const len = 4;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) buf[i] = Math.floor(rand() * 256);
  return buf;
}

function rulesEquivalent(
  lhs: Op[],
  rhs: Op[],
  samples: number,
  seed: number,
): { ok: boolean; failures: { stack: StackItem[]; lhsOut: InterpreterResult; rhsOut: InterpreterResult }[] } {
  const rand = mulberry32(seed);
  // We need enough items on the stack to run OP_PICK/OP_ROLL N with N
  // up to the largest constant the rule references, plus an extra buffer
  // so consumed items don't underflow.
  let largestConst = 0;
  for (const op of [...lhs, ...rhs]) {
    if (op >= Op.OP_1 && op <= Op.OP_16) {
      largestConst = Math.max(largestConst, op - 0x50);
    }
  }
  const baseDepth = Math.max(8, largestConst + 4);
  const failures: { stack: StackItem[]; lhsOut: InterpreterResult; rhsOut: InterpreterResult }[] = [];

  for (let i = 0; i < samples; i += 1) {
    const stack: StackItem[] = [];
    for (let k = 0; k < baseDepth; k += 1) stack.push(randomStackItem(rand));

    const lhsOut = execute(lhs as Script, stack);
    const rhsOut = execute(rhs as Script, stack);

    // Both must either both succeed and reach identical stacks, or both
    // fail. (Both-failing is a free pass — neither sequence reached a
    // meaningful end state, so they trivially "agree" in the sense that
    // the rewrite preserved the script's failure behaviour.)
    if (lhsOut.failed !== rhsOut.failed) {
      failures.push({ stack, lhsOut, rhsOut });
      continue;
    }
    if (!lhsOut.failed && !stacksEqual(lhsOut.stack, rhsOut.stack)) {
      failures.push({ stack, lhsOut, rhsOut });
    }
  }
  return { ok: failures.length === 0, failures };
}

// ----------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------

describe('optimisation rule property tests', () => {
  it('every rule shrinks or is size-neutral', () => {
    for (const rule of OPTIMISATION_RULES) {
      expect(rule.rhs.length).toBeLessThanOrEqual(rule.lhs.length);
    }
  });

  OPTIMISATION_RULES.forEach((rule, idx) => {
    it(`rule ${idx} preserves behaviour: ${rule.source}`, () => {
      // 50 random starting stacks per rule. Seed is rule-derived so each
      // rule gets its own deterministic battery.
      const { ok, failures } = rulesEquivalent(rule.lhs, rule.rhs, 50, 0xC0FFEE + idx);
      if (!ok) {
        // eslint-disable-next-line no-console
        console.log(`failures for rule ${rule.source}:`, failures.slice(0, 3).map((f) => ({
          stack: f.stack.map((s) => Array.from(s)),
          lhsFailed: f.lhsOut.failed,
          rhsFailed: f.rhsOut.failed,
          lhsTop: f.lhsOut.stack.length > 0 ? Array.from(f.lhsOut.stack[f.lhsOut.stack.length - 1]) : null,
          rhsTop: f.rhsOut.stack.length > 0 ? Array.from(f.rhsOut.stack[f.rhsOut.stack.length - 1]) : null,
        })));
      }
      expect(ok).toBe(true);
    });
  });
});

describe('end-to-end optimiser invariants', () => {
  it('optimiseBytecode is idempotent on its own output', () => {
    // Build a few random scripts and assert that optimiseBytecode reaches
    // a fixed point — a second call should not change the result.
    const rand = mulberry32(0xBEEF);
    const opcodePool: Op[] = [
      Op.OP_DUP, Op.OP_DROP, Op.OP_NIP, Op.OP_SWAP, Op.OP_ROT,
      Op.OP_OVER, Op.OP_PICK, Op.OP_ROLL, Op.OP_EQUAL, Op.OP_VERIFY,
      Op.OP_NUMEQUAL, Op.OP_HASH160, Op.OP_HASH256, Op.OP_SHA256,
      Op.OP_1ADD, Op.OP_ADD, Op.OP_NOT, Op.OP_0, Op.OP_1, Op.OP_2, Op.OP_3,
    ];
    for (let i = 0; i < 50; i += 1) {
      const len = 4 + Math.floor(rand() * 8);
      const s: Op[] = [];
      for (let k = 0; k < len; k += 1) s.push(opcodePool[Math.floor(rand() * opcodePool.length)]);
      const once = optimiseBytecode([...s]);
      const twice = optimiseBytecode([...once]);
      expect(scriptToAsm(twice)).toEqual(scriptToAsm(once));
    }
  });

  it('optimiseBytecode never grows the script', () => {
    const rand = mulberry32(0xDEAD);
    const opcodePool: Op[] = [
      Op.OP_DUP, Op.OP_NIP, Op.OP_SWAP, Op.OP_OVER, Op.OP_DROP,
      Op.OP_EQUAL, Op.OP_VERIFY, Op.OP_NUMEQUAL, Op.OP_NOT, Op.OP_IF,
      Op.OP_ENDIF, Op.OP_ADD, Op.OP_SUB, Op.OP_HASH160,
      Op.OP_0, Op.OP_1, Op.OP_PICK, Op.OP_ROLL,
    ];
    for (let i = 0; i < 50; i += 1) {
      const len = 4 + Math.floor(rand() * 10);
      const s: Op[] = [];
      for (let k = 0; k < len; k += 1) s.push(opcodePool[Math.floor(rand() * opcodePool.length)]);
      const opt = optimiseBytecode([...s]);
      expect(opt.length).toBeLessThanOrEqual(s.length);
    }
  });

  it('rejects rules that grow at parse time', () => {
    // Smoke check the parse-time guard. The real check is that
    // OPTIMISATION_RULES was successfully populated at module load (this
    // assertion just confirms it didn't get accidentally weakened).
    expect(OPTIMISATION_RULES.length).toBeGreaterThan(50);
    for (const rule of OPTIMISATION_RULES) {
      expect(rule.rhs.length).toBeLessThanOrEqual(rule.lhs.length);
      expect(rule.lhs.length).toBeGreaterThan(0);
    }
  });
});

// ----------------------------------------------------------------------
// Boundary cases the audit flagged near removeFinalVerify (§4 carry-over,
// referenced again in §10.2 follow-up):
//
// > removeFinalVerify's comment block mentions logic about stack length
// > < 4 vs >= 4 but OP_NIP for cleanup is always emitted via the
// > per-iteration cleanStack. Worth a stress test where stack depth is
// > exactly 3 and 4.
//
// We can't directly inspect the codegen's stack-depth state from here,
// so we replicate the two shapes it would emit and assert the optimiser
// preserves their behaviour and shrinks them appropriately.
// ----------------------------------------------------------------------

describe('removeFinalVerify stack-depth boundary (audit §4 / §10.2)', () => {
  // The audit asked for behavioural coverage of the boundary, not an
  // assertion that the optimiser leaves the tail untouched. Rules like
  // OP_1 OP_NIP -> OP_DROP OP_1 and OP_DROP OP_DROP -> OP_2DROP
  // legitimately rewrite the cleanup pattern. What matters is that the
  // rewritten and original tails leave the stack in the same final
  // state for both branches of the codegen.

  function assertEquivalent(tail: Script, startingStack: Uint8Array[]): void {
    const opt = optimiseBytecode([...tail]);
    const originalResult = execute(tail, startingStack);
    const optimisedResult = execute(opt, startingStack);
    expect(originalResult.failed).toBe(optimisedResult.failed);
    if (!originalResult.failed) {
      expect(stacksEqual(originalResult.stack, optimisedResult.stack)).toBe(true);
    }
    // Optimised tail must never be longer than the original.
    expect(opt.length).toBeLessThanOrEqual(tail.length);
  }

  // Codegen pattern A (stack.length == 3 before removeFinalVerify):
  //   OP_VERIFY is *removed* from the script; final value already on
  //   stack. cleanStack then emits 2x OP_NIP. The opcode tail visible
  //   to the optimiser is just the two NIPs.
  it('depth 3: 2x OP_NIP cleanup is behaviourally preserved', () => {
    const tail: Script = [Op.OP_NIP, Op.OP_NIP];
    assertEquivalent(tail, [encodeInt(7), encodeInt(8), encodeInt(9)]);
  });

  // Codegen pattern B (stack.length == 4 before removeFinalVerify):
  //   OP_VERIFY is *kept* and OP_1 pushed; cleanStack then emits 3x
  //   OP_NIP. The audit's worry is that rewrites in the OP_NIP chain
  //   could lose the success indicator.
  it('depth 4: OP_VERIFY OP_1 + 3x OP_NIP cleanup is behaviourally preserved', () => {
    const tail: Script = [Op.OP_VERIFY, Op.OP_1, Op.OP_NIP, Op.OP_NIP, Op.OP_NIP];
    // VERIFY needs a truthy value at the top.
    assertEquivalent(tail, [encodeInt(11), encodeInt(12), encodeInt(13), encodeInt(1)]);
  });

  it('depth 4: optimised tail still leaves OP_1 on the stack', () => {
    // Direct semantic check: after the optimiser is done, executing the
    // tail on the depth-4 starting stack must finish with the single
    // value OP_1 on the stack (the success indicator) and nothing else.
    const tail: Script = [Op.OP_VERIFY, Op.OP_1, Op.OP_NIP, Op.OP_NIP, Op.OP_NIP];
    const opt = optimiseBytecode([...tail]);
    const startStack = [encodeInt(11), encodeInt(12), encodeInt(13), encodeInt(1)];
    const res = execute(opt, startStack);
    expect(res.failed).toBe(false);
    expect(res.stack.length).toBe(1);
    expect(Array.from(res.stack[0])).toEqual(Array.from(encodeInt(1)));
  });

  it('depth 4: tail with surrounding optimisable ops stays behaviourally equivalent', () => {
    const tail: Script = [
      Op.OP_SHA256, Op.OP_SHA256, // -> OP_HASH256
      Op.OP_VERIFY, Op.OP_1,
      Op.OP_NIP, Op.OP_NIP, Op.OP_NIP,
    ];
    // The OP_SHA256 OP_SHA256 leading pair operates on whatever is on
    // top; for VERIFY to succeed the hash of the original top must be
    // truthy. SHA256 is bytewise deterministic and almost certainly
    // truthy for any non-empty input, so this is fine.
    assertEquivalent(tail, [encodeInt(11), encodeInt(12), encodeInt(13), Uint8Array.from([1, 2, 3, 4])]);
  });

  it('depth 3: tail with optimisable head stays behaviourally equivalent', () => {
    const tail: Script = [
      Op.OP_SHA256, Op.OP_SHA256, // -> OP_HASH256
      Op.OP_NIP, Op.OP_NIP,
    ];
    assertEquivalent(tail, [encodeInt(7), encodeInt(8), Uint8Array.from([9, 9, 9, 9])]);
  });
});

// ----------------------------------------------------------------------
// Spot checks against prefix collisions that the legacy regex pipeline
// was fragile to. These are the cases the audit explicitly flagged
// ("OP_OR vs OP_ROT is fine because spaces separate, but a future
// careless .equiv rule…").
// ----------------------------------------------------------------------

describe('prefix-collision safety', () => {
  it('OP_NOT OP_IF is collapsed to OP_NOTIF', () => {
    const s: Script = [Op.OP_NOT, Op.OP_IF, Op.OP_1, Op.OP_ENDIF];
    expect(scriptToAsm(optimiseBytecode([...s]))).toEqual('OP_NOTIF OP_1 OP_ENDIF');
  });

  it('OP_NUMEQUAL OP_NOT does not nibble into a following OP_NOTIF', () => {
    // The regex `OP_NUMEQUAL OP_NOT` would happily eat the OP_NOT prefix
    // of `OP_NOTIF` and produce the invalid `OP_NUMNOTEQUALIF`. The
    // opcode-list pass must NOT do this — it should leave the script
    // intact (no rule applies because OP_NOT is a distinct opcode from
    // OP_NOTIF at the opcode-list level).
    const s: Script = [Op.OP_NUMEQUAL, Op.OP_NOTIF, Op.OP_1, Op.OP_ENDIF];
    const opt = optimiseBytecode([...s]);
    // OP_NUMEQUAL OP_NOTIF should round-trip unchanged (no rule matches
    // this specific pair).
    expect(scriptToAsm(opt)).toEqual('OP_NUMEQUAL OP_NOTIF OP_1 OP_ENDIF');
  });

  it('OP_SWAP OP_EQUAL collapses to OP_EQUAL but does not eat into OP_EQUALVERIFY twice', () => {
    // After the first iteration:
    //   [SWAP, EQUAL, VERIFY] -> [EQUAL, VERIFY] -> [EQUALVERIFY] via two rules.
    // After the explicit derived rule:
    //   [SWAP, EQUALVERIFY]  -> [EQUALVERIFY]
    // Both inputs should converge to the same single OP_EQUALVERIFY.
    const a: Script = [Op.OP_SWAP, Op.OP_EQUAL, Op.OP_VERIFY];
    const b: Script = [Op.OP_SWAP, Op.OP_EQUALVERIFY];
    expect(scriptToAsm(optimiseBytecode([...a]))).toEqual('OP_EQUALVERIFY');
    expect(scriptToAsm(optimiseBytecode([...b]))).toEqual('OP_EQUALVERIFY');
  });
});
