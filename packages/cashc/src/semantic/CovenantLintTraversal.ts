import { PrimitiveType, LintWarning } from '@radiantscript/utils';
import {
  ContractNode,
  FunctionDefinitionNode,
  VariableDefinitionNode,
  AssignNode,
  IdentifierNode,
  UnaryOpNode,
  NullaryOpNode,
  BinaryOpNode,
  FunctionCallNode,
  InstantiationNode,
  PushRefNode,
  StatementNode,
  ExpressionNode,
  Node,
} from '../ast/AST.js';
import AstTraversal from '../ast/AstTraversal.js';
import { BinaryOperator, NullaryOperator, UnaryOperator } from '../ast/Operator.js';
import { Class, GlobalFunction, PushRefOp } from '../ast/Globals.js';
import { Location } from '../ast/Location.js';

// ---------------------------------------------------------------------------
// Operator/function classification helpers
//
// These sets group the introspection primitives by the footgun they relate to.
// Keeping them as data (rather than scattered `if`s) makes the heuristics below
// short and auditable.
// ---------------------------------------------------------------------------

// Per-index OUTPUT field reads. Pinning one of these proves *which* output a
// constraint applies to. Several diagnostics key off whether any of these appear.
const OUTPUT_FIELD_UNARY_OPS: ReadonlySet<UnaryOperator> = new Set([
  UnaryOperator.OUTPUT_VALUE,
  UnaryOperator.OUTPUT_LOCKING_BYTECODE,
  UnaryOperator.OUTPUT_CODESCRIPTBYTECODE,
  UnaryOperator.OUTPUT_STATESCRIPTBYTECODE,
  UnaryOperator.OUTPUT_REFHASH_DATA_SUMMARY,
  UnaryOperator.OUTPUT_REF_DATA_SUMMARY,
  UnaryOperator.OUTPUT_STATESEPARATOR_INDEX,
]);

// Per-index OUTPUT reads that *pin* an output's recipient / script / state — i.e.
// they constrain WHERE value goes (not merely read a summary). Used by the
// value-conservation rule to decide "are outputs constrained at all".
const OUTPUT_PIN_UNARY_OPS: ReadonlySet<UnaryOperator> = new Set([
  UnaryOperator.OUTPUT_VALUE,
  UnaryOperator.OUTPUT_LOCKING_BYTECODE,
  UnaryOperator.OUTPUT_CODESCRIPTBYTECODE,
  UnaryOperator.OUTPUT_STATESCRIPTBYTECODE,
]);

// The covenant reading its OWN code script (continuity source).
const SELF_CODESCRIPT_UNARY_OPS: ReadonlySet<UnaryOperator> = new Set([
  UnaryOperator.INPUT_CODESCRIPTBYTECODE,
]);

// OUTPUT-side ref / code-script aggregates: they sum or count across the whole
// output set but never identify a single output.
const OUTPUT_AGGREGATE_FUNCTIONS: ReadonlySet<GlobalFunction> = new Set([
  GlobalFunction.REFHASHVALUESUM_OUTPUTS,
  GlobalFunction.REFTYPE_OUTPUT,
  GlobalFunction.REFVALUESUM_OUTPUTS,
  GlobalFunction.REFOUTPUTCOUNT_OUTPUTS,
  GlobalFunction.REFOUTPUTCOUNTZEROVALUED_OUTPUTS,
  GlobalFunction.CODESCRIPTHASHVALUESUM_OUTPUTS,
  GlobalFunction.CODESCRIPTHASHOUTPUTCOUNT_OUTPUTS,
  GlobalFunction.CODESCRIPTHASHZEROVALUEDOUTPUTCOUNT_OUTPUTS,
]);

// Any ref / code-script aggregate (input- or output-side). Used by the
// aggregate-only heuristic.
const ALL_AGGREGATE_FUNCTIONS: ReadonlySet<GlobalFunction> = new Set([
  ...OUTPUT_AGGREGATE_FUNCTIONS,
  GlobalFunction.REFHASHVALUESUM_UTXOS,
  GlobalFunction.REFTYPE_UTXO,
  GlobalFunction.REFVALUESUM_UTXOS,
  GlobalFunction.REFOUTPUTCOUNT_UTXOS,
  GlobalFunction.REFOUTPUTCOUNTZEROVALUED_UTXOS,
  GlobalFunction.CODESCRIPTHASHVALUESUM_UTXOS,
  GlobalFunction.CODESCRIPTHASHOUTPUTCOUNT_UTXOS,
  GlobalFunction.CODESCRIPTHASHZEROVALUEDOUTPUTCOUNT_UTXOS,
]);

// codeScriptCount aggregates specifically — these are what assert the covenant
// is carried forward into the same code script.
const CODESCRIPT_COUNT_FUNCTIONS: ReadonlySet<GlobalFunction> = new Set([
  GlobalFunction.CODESCRIPTHASHOUTPUTCOUNT_UTXOS,
  GlobalFunction.CODESCRIPTHASHOUTPUTCOUNT_OUTPUTS,
  GlobalFunction.CODESCRIPTHASHZEROVALUEDOUTPUTCOUNT_UTXOS,
  GlobalFunction.CODESCRIPTHASHZEROVALUEDOUTPUTCOUNT_OUTPUTS,
]);

// *ValueSum aggregates — the supply-conservation primitives (sum satoshi/token
// value across the whole input or output set).
const VALUE_SUM_INPUT_FUNCTIONS: ReadonlySet<GlobalFunction> = new Set([
  GlobalFunction.REFHASHVALUESUM_UTXOS,
  GlobalFunction.REFVALUESUM_UTXOS,
  GlobalFunction.CODESCRIPTHASHVALUESUM_UTXOS,
]);
const VALUE_SUM_OUTPUT_FUNCTIONS: ReadonlySet<GlobalFunction> = new Set([
  GlobalFunction.REFHASHVALUESUM_OUTPUTS,
  GlobalFunction.REFVALUESUM_OUTPUTS,
  GlobalFunction.CODESCRIPTHASHVALUESUM_OUTPUTS,
]);

// *Count aggregates (carrier counts). Both input- and output-side. Used by the
// conservation-identity refinement: a balanced count identity
// (codeScriptCount(csh) == refOutputCount(ref)) ties carriers together.
const COUNT_FUNCTIONS: ReadonlySet<GlobalFunction> = new Set([
  GlobalFunction.REFOUTPUTCOUNT_UTXOS,
  GlobalFunction.REFOUTPUTCOUNT_OUTPUTS,
  GlobalFunction.REFOUTPUTCOUNTZEROVALUED_UTXOS,
  GlobalFunction.REFOUTPUTCOUNTZEROVALUED_OUTPUTS,
  GlobalFunction.CODESCRIPTHASHOUTPUTCOUNT_UTXOS,
  GlobalFunction.CODESCRIPTHASHOUTPUTCOUNT_OUTPUTS,
  GlobalFunction.CODESCRIPTHASHZEROVALUEDOUTPUTCOUNT_UTXOS,
  GlobalFunction.CODESCRIPTHASHZEROVALUEDOUTPUTCOUNT_OUTPUTS,
]);

// tx-wide INPUT aggregates — these account value/carriers across ALL inputs, so
// a covenant carrying one of these is NOT reasoning about a single input in
// isolation (defeats the per-active-input co-spend footgun).
const INPUT_AGGREGATE_FUNCTIONS: ReadonlySet<GlobalFunction> = new Set([
  GlobalFunction.REFHASHVALUESUM_UTXOS,
  GlobalFunction.REFVALUESUM_UTXOS,
  GlobalFunction.CODESCRIPTHASHVALUESUM_UTXOS,
  GlobalFunction.REFOUTPUTCOUNT_UTXOS,
  GlobalFunction.REFOUTPUTCOUNTZEROVALUED_UTXOS,
  GlobalFunction.CODESCRIPTHASHOUTPUTCOUNT_UTXOS,
  GlobalFunction.CODESCRIPTHASHZEROVALUEDOUTPUTCOUNT_UTXOS,
]);

const SIGNATURE_CHECK_FUNCTIONS: ReadonlySet<GlobalFunction> = new Set([
  GlobalFunction.CHECKSIG,
  GlobalFunction.CHECKMULTISIG,
  GlobalFunction.CHECKDATASIG,
]);

const PUSH_REF_OPS: ReadonlySet<string> = new Set(Object.values(PushRefOp));

// ---------------------------------------------------------------------------
// Value-source tokens
//
// To reason about value conservation without full data-flow we tag every
// expression subtree with the *kinds* of value source it transitively reads.
// A balanced identity / an input-vs-output comparison is then a question about
// which tokens land on each side of an `==`.
// ---------------------------------------------------------------------------

type ValueToken =
  | 'IN_VALUE' // tx.inputs[i].value
  | 'OUT_VALUE' // tx.outputs[i].value
  | 'IN_VALUESUM' // tx.inputs.*ValueSum
  | 'OUT_VALUESUM' // tx.outputs.*ValueSum
  | 'IN_COUNT' // tx.inputs.*Count
  | 'OUT_COUNT'; // tx.outputs.*Count

const INPUT_VALUE_TOKENS: ReadonlySet<ValueToken> = new Set(['IN_VALUE', 'IN_VALUESUM']);
const OUTPUT_VALUE_TOKENS: ReadonlySet<ValueToken> = new Set(['OUT_VALUE', 'OUT_VALUESUM']);

function isValueType(type: unknown): boolean {
  return type === PrimitiveType.INT || type === PrimitiveType.BOOL;
}

// The set of value-source tokens an expression transitively reads. Local
// identifiers are resolved through `localTokens`; unknown identifiers contribute
// nothing (conservative).
function tokensOf(
  node: ExpressionNode | undefined,
  localTokens: Map<string, Set<ValueToken>>,
): Set<ValueToken> {
  const tokens = new Set<ValueToken>();
  if (!node) return tokens;
  const visit = (n: Node | undefined): void => {
    if (!n) return;
    if (n instanceof UnaryOpNode) {
      if (n.operator === UnaryOperator.INPUT_VALUE) tokens.add('IN_VALUE');
      if (n.operator === UnaryOperator.OUTPUT_VALUE) tokens.add('OUT_VALUE');
      visit(n.expression);
      return;
    }
    if (n instanceof FunctionCallNode) {
      const name = n.identifier.name as GlobalFunction;
      if (VALUE_SUM_INPUT_FUNCTIONS.has(name)) tokens.add('IN_VALUESUM');
      if (VALUE_SUM_OUTPUT_FUNCTIONS.has(name)) tokens.add('OUT_VALUESUM');
      if (COUNT_FUNCTIONS.has(name)) {
        tokens.add(INPUT_AGGREGATE_FUNCTIONS.has(name) ? 'IN_COUNT' : 'OUT_COUNT');
      }
      n.parameters.forEach(visit);
      return;
    }
    if (n instanceof IdentifierNode) {
      localTokens.get(n.name)?.forEach((t) => tokens.add(t));
      return;
    }
    // Generic recurse for binary ops / casts / arrays / tuple-index / etc.
    Object.values(n).forEach((value) => {
      if (value instanceof Node) visit(value);
      else if (Array.isArray(value)) value.forEach((v) => { if (v instanceof Node) visit(v); });
    });
  };
  visit(node);
  return tokens;
}

// Pre-pass: resolve each local variable's value provenance (the tokens its
// defining expression reads). Two passes reach a shallow fixpoint so a local
// defined from another local inherits its tokens regardless of source order.
function buildLocalTokens(statements: StatementNode[]): Map<string, Set<ValueToken>> {
  const localTokens = new Map<string, Set<ValueToken>>();
  for (let pass = 0; pass < 2; pass += 1) {
    statements.forEach((statement) => {
      if (statement instanceof VariableDefinitionNode) {
        localTokens.set(statement.name, tokensOf(statement.expression, localTokens));
      } else if (statement instanceof AssignNode) {
        const existing = localTokens.get(statement.identifier.name) ?? new Set();
        tokensOf(statement.expression, localTokens).forEach((t) => existing.add(t));
        localTokens.set(statement.identifier.name, existing);
      }
    });
  }
  return localTokens;
}

// True when an `==` comparison relates an INPUT value source to an OUTPUT value
// source across both sides (the balanced *ValueSum identity, the Vault
// out0+out1+fee == inputValue, or the burn in - x == out). Locals are resolved.
function relatesInputToOutputValue(
  node: BinaryOpNode,
  localTokens: Map<string, Set<ValueToken>>,
): boolean {
  const union = new Set<ValueToken>([
    ...tokensOf(node.left, localTokens),
    ...tokensOf(node.right, localTokens),
  ]);
  const touchesInput = [...union].some((t) => INPUT_VALUE_TOKENS.has(t));
  const touchesOutput = [...union].some((t) => OUTPUT_VALUE_TOKENS.has(t));
  return touchesInput && touchesOutput;
}

// ---------------------------------------------------------------------------
// Key-aware aggregate matching (F-1 / F-2)
//
// A *ValueSum/*Count aggregate carries a KEY argument (a ref or code-script
// hash). A balanced conservation identity is only sound when BOTH sides
// reference the SAME key — `codeScriptValueSum(cshA) == codeScriptValueSum(cshB)`
// with DIFFERENT keys conserves NOTHING about the real value pool. So when we
// read a balanced identity off an `==`, we must compare the aggregates' key
// fingerprints, not merely their kinds.
//
// A `KeyFingerprint` is a stable string that is EQUAL across two aggregate
// arguments iff we can prove they denote the same key:
//   - the same constant/parameter/local identifier  -> `id:<name>`
//   - the same int/hex literal                       -> `lit:<value>`
//   - the canonical self-csh idiom                   -> `csh-idiom`
//       (hash256(tx.inputs[this.activeInputIndex].codeScript), possibly bound
//        through a local — FungibleToken / StatefulCounter write
//        `bytes32 csh = hash256(...)` then key both sides off `csh`).
// Anything else (an opaque spender-supplied expression we cannot canonicalise)
// returns `undefined`, and an `undefined` key NEVER matches another key — we
// fail safe toward warning.
// ---------------------------------------------------------------------------

type KeyFingerprint = string;

// True when `node` is the canonical self-code-script-hash idiom
// `hash256(tx.inputs[this.activeInputIndex].codeScript)` (matched structurally).
function isSelfCodeScriptHash(node: ExpressionNode | undefined): boolean {
  if (!(node instanceof FunctionCallNode)) return false;
  if (node.identifier.name !== GlobalFunction.HASH256) return false;
  const [arg] = node.parameters;
  return arg instanceof UnaryOpNode
    && arg.operator === UnaryOperator.INPUT_CODESCRIPTBYTECODE
    && indexesActiveInput(arg.expression);
}

// Canonicalise an aggregate's KEY argument to a fingerprint that is equal across
// two args iff we can prove they are the same key. `cshLocals` names locals that
// were bound to the canonical self-csh idiom, so a key read off such a local maps
// to the same `csh-idiom` fingerprint as the inline idiom.
function keyFingerprintOf(
  node: ExpressionNode | undefined,
  cshLocals: ReadonlySet<string>,
): KeyFingerprint | undefined {
  if (!node) return undefined;
  if (isSelfCodeScriptHash(node)) return 'csh-idiom';
  if (node instanceof IdentifierNode) {
    return cshLocals.has(node.name) ? 'csh-idiom' : `id:${node.name}`;
  }
  const literal = asIntLiteral(node);
  if (literal !== undefined) return `lit:${literal.toString()}`;
  const hex = (node as { value?: unknown }).value;
  if (typeof hex === 'string') return `lit:${hex}`;
  return undefined;
}

// Canonicalise a REF argument (the ref fed to pushInputRef / refOutputCount) to
// a fingerprint that is EQUAL across two args iff we can prove they denote the
// same ref: the same identifier (constant/param/local) -> `id:<name>`, or the
// same hex literal bytes -> `hex:<bytes>`. Anything we cannot canonicalise
// returns `undefined`, which NEVER matches another fingerprint (fail safe toward
// warning — we cannot prove the forwarded ref is the one being contained).
function refFingerprintOf(node: ExpressionNode | undefined): KeyFingerprint | undefined {
  if (!node) return undefined;
  if (node instanceof IdentifierNode) return `id:${node.name}`;
  const value = (node as { value?: unknown }).value;
  if (value instanceof Uint8Array) return `hex:${Buffer.from(value).toString('hex')}`;
  if (typeof value === 'string') return `hex:${value}`;
  return undefined;
}

type AggregateKind = 'IN_VALUESUM' | 'OUT_VALUESUM' | 'IN_COUNT' | 'OUT_COUNT';

interface AggregateRef {
  kind: AggregateKind;
  key: KeyFingerprint | undefined;
}

// The aggregate call (if any) at the head of an expression side, with its kind
// and key fingerprint. Resolves a local bound directly to an aggregate (e.g.
// `int inVal = codeScriptValueSum(csh)`) through `localAggregates`.
function aggregateRefOf(
  node: ExpressionNode | undefined,
  cshLocals: ReadonlySet<string>,
  localAggregates: ReadonlyMap<string, AggregateRef>,
): AggregateRef | undefined {
  if (!node) return undefined;
  if (node instanceof FunctionCallNode) {
    const name = node.identifier.name as GlobalFunction;
    const key = keyFingerprintOf(node.parameters[0], cshLocals);
    if (VALUE_SUM_INPUT_FUNCTIONS.has(name)) return { kind: 'IN_VALUESUM', key };
    if (VALUE_SUM_OUTPUT_FUNCTIONS.has(name)) return { kind: 'OUT_VALUESUM', key };
    if (COUNT_FUNCTIONS.has(name)) {
      return { kind: INPUT_AGGREGATE_FUNCTIONS.has(name) ? 'IN_COUNT' : 'OUT_COUNT', key };
    }
    return undefined;
  }
  if (node instanceof IdentifierNode) {
    return localAggregates.get(node.name);
  }
  return undefined;
}

// True when two aggregate sides form a sound balanced *ValueSum identity: one
// input-side *ValueSum, one output-side *ValueSum, BOTH with the SAME provable
// key. An `undefined` key never matches (opaque / spender-supplied), so a
// mismatched or opaque key is rejected (fail safe toward warning).
function isBalancedValueSum(
  a: AggregateRef | undefined,
  b: AggregateRef | undefined,
): boolean {
  if (!a || !b) return false;
  const pair = new Set([a.kind, b.kind]);
  if (!(pair.has('IN_VALUESUM') && pair.has('OUT_VALUESUM'))) return false;
  return a.key !== undefined && a.key === b.key;
}

// True when BOTH sides are pure aggregate calls whose keys do NOT provably match
// (different fingerprints, or either is opaque). Used to reject a mismatched-key
// aggregate==aggregate from counting as a value relation (the F-1 leak).
function mismatchedKeyAggregatePair(
  a: AggregateRef | undefined,
  b: AggregateRef | undefined,
): boolean {
  if (!a || !b) return false;
  return a.key === undefined || b.key === undefined || a.key !== b.key;
}

// ---------------------------------------------------------------------------
// Per-function fact collection
//
// A small inner traversal that walks ONE function subtree and records boolean
// flags / name sets. We deliberately don't try to do full data-flow — the
// heuristics only need "does X ever appear in this function", a few structural
// relations around `==` comparisons, and a defined-vs-read set.
// ---------------------------------------------------------------------------

class FunctionFactCollector extends AstTraversal {
  introspectsOutputField = false; // any per-index OUTPUT field (incl. OUTPUT_REF*)
  pinsOutputField = false; // per-index OUTPUT recipient/script/state/value pin
  callsOutputAggregate = false; // OUTPUT-side ref/code aggregate
  callsAnyAggregate = false; // any ref/code aggregate (in or out)
  callsCodeScriptCount = false; // codeScriptCount aggregate
  callsInputAggregate = false; // tx-wide INPUT aggregate (ValueSum/Count over inputs)
  readsOutputCount = false; // tx.outputs.length
  constrainsInputCount = false; // tx.inputs.length compared to a constant
  readsOwnCodeScript = false; // this.activeBytecode OR tx.inputs[i].codeScript
  readsActiveInputValue = false; // tx.inputs[this.activeInputIndex].value
  callsSignatureCheck = false; // checkSig / checkMultiSig / checkDataSig
  usesPushRef = false; // pushInputRef / requireInputRef / ...
  // Any kind of input/output/ref/codescript introspection at all. Used to tell
  // "auth-only" spends from covenant-style spends.
  introspectsAnything = false;

  // Conservation structure, derived from the `==` comparisons in the function.
  hasBalancedValueSum = false; // *ValueSum(in) == *ValueSum(out)
  hasBalancedCount = false; // *Count == *Count (carrier identity)
  hasInputOutputValueRelation = false; // comparison relating input value to output value

  // Output-set shape, used to recognise a sound "bounded sweep" (every output
  // pinned to a fixed recipient/script) which needs no value-conservation check.
  outputCountBound?: bigint; // N from tx.outputs.length == N
  pinnedOutputIndices: Set<number> = new Set(); // indices i with a recipient/script/state pin
  pinsNullDataOutput = false; // an output is pinned to new LockingBytecodeNullData(...)
  // A ref is carried forward to a SURVIVING output: refOutputCount(ref) or
  // codeScriptCount(csh) asserted to a positive (non-zero) carrier count.
  carriesRefForward = false;

  // L-1 (state-bound-to-noncarrier): the literal output indices that the
  // code-continuity pin targets (`tx.outputs[i].codeScript == ...`) and the
  // indices each next-state binding targets (`tx.outputs[j].stateScript == ...`).
  // When there is a SINGLE pinned continuation carrier index i and a state
  // binding targets some j != i, the carrier's state is unconstrained while a
  // non-carrier's state is bound.
  codeScriptPinIndices: Set<number> = new Set();
  stateBindIndices: Set<number> = new Set();
  // First location of a state binding (for the warning), keyed by index.
  stateBindLocationByIndex: Map<number, Location> = new Map();

  // L-2 (forwarded-ref-uncontained): the fingerprints of refs FORWARDED via a
  // non-singleton pushInputRef/requireInputRef, the fingerprints whose
  // refOutputCount is constrained against a constant, and whether a forwarded
  // ref's first location (for the warning). Singleton forwards are consensus-
  // unique and exempt, so they are tracked separately and never warned.
  forwardedRefs: Map<KeyFingerprint, Location | undefined> = new Map();
  containedRefs: Set<KeyFingerprint> = new Set();

  // codeScriptCount/refOutputCount compared to a literal that permits no carry
  // forward (== 0 or >= 0). Keyed location for the warning.
  trivialContinuityLocation?: Location;
  trivialContinuityFn?: string;

  // First source location seen for the output-side introspection / aggregate /
  // self-codescript / signature / active-input-value flags.
  outputFieldLocation?: Location;
  outputAggregateLocation?: Location;
  anyAggregateLocation?: Location;
  ownCodeScriptLocation?: Location;
  signatureLocation?: Location;
  activeInputValueLocation?: Location;

  // name -> the value tokens its defining expression transitively reads. Built
  // in a pre-pass so identifiers inside `==` comparisons resolve to their source.
  private localTokens: Map<string, Set<ValueToken>> = new Map();

  // Locals bound to `new LockingBytecodeNullData(...)` — so an output pin written
  // against such a local (the common `bytes nd = new ...; outputs[0]... == nd`
  // idiom) is recognised as a provable-destruction pin.
  private nullDataLocals: Set<string> = new Set();

  // Locals bound to the canonical self-csh idiom
  // `hash256(tx.inputs[this.activeInputIndex].codeScript)` — so a key read off
  // such a local canonicalises to the same `csh-idiom` fingerprint (F-1/F-2).
  private cshLocals: Set<string> = new Set();

  // Locals bound DIRECTLY to an aggregate call (e.g.
  // `int inVal = codeScriptValueSum(csh)`), so a balanced identity written
  // against the local still resolves to the aggregate's kind + key (F-1/F-2).
  private localAggregates: Map<string, AggregateRef> = new Map();

  // L-2: locals bound to the RESULT of a pushInputRef/requireInputRef/... — in
  // Radiant the push-ref op returns the ref it pushed, so
  // `bytes36 ref = pushInputRef(REF)` makes `ref` an ALIAS of REF. We map the
  // local's fingerprint (`id:ref`) to the underlying ref fingerprint (`id:REF`)
  // so a later `refOutputCount(ref)` is recognised as constraining REF.
  private refAliases: Map<KeyFingerprint, KeyFingerprint> = new Map();

  constructor(statements: StatementNode[]) {
    super();
    this.localTokens = buildLocalTokens(statements);
    // First pass: collect csh-idiom locals so aggregate-key resolution below can
    // canonicalise a key read off such a local.
    statements.forEach((statement) => {
      if (
        statement instanceof VariableDefinitionNode
        && isSelfCodeScriptHash(statement.expression)
      ) {
        this.cshLocals.add(statement.name);
      }
    });
    statements.forEach((statement) => {
      if (
        statement instanceof VariableDefinitionNode
        && containsNullDataInstantiation(statement.expression)
      ) {
        this.nullDataLocals.add(statement.name);
      }
      if (statement instanceof VariableDefinitionNode) {
        const agg = aggregateRefOf(statement.expression, this.cshLocals, this.localAggregates);
        if (agg) this.localAggregates.set(statement.name, agg);
      }
      // L-2 ref aliasing: `bytes36 ref = pushInputRef(REF)` -> id:ref aliases id:REF.
      if (
        statement instanceof VariableDefinitionNode
        && statement.expression instanceof PushRefNode
      ) {
        const underlying = refFingerprintOf(statement.expression.ref);
        if (underlying !== undefined) {
          this.refAliases.set(`id:${statement.name}`, underlying);
        }
      }
    });
  }

  // The set of value-source tokens an expression transitively reads, resolving
  // locals through this function's pre-built provenance map.
  private tokensOf(node: ExpressionNode | undefined): Set<ValueToken> {
    return tokensOf(node, this.localTokens);
  }

  // The aggregate call (kind + key fingerprint) at the head of an expression side,
  // resolving csh-idiom keys and locals bound directly to an aggregate.
  private aggregateRefOf(node: ExpressionNode | undefined): AggregateRef | undefined {
    return aggregateRefOf(node, this.cshLocals, this.localAggregates);
  }

  // L-2: the CANONICAL ref fingerprint, resolving a local aliased to a forwarded
  // ref (`bytes36 ref = pushInputRef(REF)` -> `id:ref` resolves to `id:REF`) so a
  // forward and a containment written against different-but-aliased names match.
  private refFingerprintOf(node: ExpressionNode | undefined): KeyFingerprint | undefined {
    const fp = refFingerprintOf(node);
    if (fp === undefined) return undefined;
    return this.refAliases.get(fp) ?? fp;
  }

  visitUnaryOp(node: UnaryOpNode): Node {
    if (OUTPUT_FIELD_UNARY_OPS.has(node.operator)) {
      this.introspectsOutputField = true;
      this.introspectsAnything = true;
      this.outputFieldLocation ??= node.location;
    }
    if (OUTPUT_PIN_UNARY_OPS.has(node.operator)) {
      this.pinsOutputField = true;
    }
    if (SELF_CODESCRIPT_UNARY_OPS.has(node.operator)) {
      this.readsOwnCodeScript = true;
      this.ownCodeScriptLocation ??= node.location;
    }
    // tx.inputs[this.activeInputIndex].value — the per-active-input value read at
    // the heart of the co-spend reentrancy footgun.
    if (node.operator === UnaryOperator.INPUT_VALUE && indexesActiveInput(node.expression)) {
      this.readsActiveInputValue = true;
      this.activeInputValueLocation ??= node.location;
    }
    // Any input/output introspection (values, bytecode, refs, etc.) marks the
    // function as "constrains the transaction shape" for the auth-only check.
    if (node.operator.includes('tx.inputs[i]') || node.operator.includes('tx.outputs[i]')) {
      this.introspectsAnything = true;
    }
    return super.visitUnaryOp(node);
  }

  visitNullaryOp(node: NullaryOpNode): Node {
    if (node.operator === NullaryOperator.OUTPUT_COUNT) {
      this.readsOutputCount = true;
      this.introspectsAnything = true;
    }
    if (node.operator === NullaryOperator.INPUT_COUNT) {
      this.introspectsAnything = true;
    }
    if (node.operator === NullaryOperator.BYTECODE) {
      this.readsOwnCodeScript = true;
      this.ownCodeScriptLocation ??= node.location;
    }
    return super.visitNullaryOp(node);
  }

  visitPushRef(node: PushRefNode): Node {
    // pushInputRef / requireInputRef / pushInputRefSingleton / ... is a dedicated
    // PushRefNode (NOT a FunctionCall), so it is collected here.
    this.usesPushRef = true;
    this.introspectsAnything = true;
    // L-2: a NON-SINGLETON forward (pushInputRef / requireInputRef) is a subset
    // forward — consensus only enforces output-refs ⊆ input-refs, so the ref may
    // appear in EXTRA outputs unless the function pins its output containment.
    // Singleton ops (pushInputRefSingleton) are consensus-unique and exempt.
    if (node.op === PushRefOp.PUSHINPUTREF || node.op === PushRefOp.REQUIREINPUTREF) {
      const fp = this.refFingerprintOf(node.ref);
      if (fp !== undefined && !this.forwardedRefs.has(fp)) {
        this.forwardedRefs.set(fp, node.location ?? node.ref.location);
      }
    }
    return super.visitPushRef(node);
  }

  visitFunctionCall(node: FunctionCallNode): Node {
    const name = node.identifier.name as GlobalFunction;
    if (ALL_AGGREGATE_FUNCTIONS.has(name)) {
      this.callsAnyAggregate = true;
      this.introspectsAnything = true;
      this.anyAggregateLocation ??= node.location;
    }
    if (OUTPUT_AGGREGATE_FUNCTIONS.has(name)) {
      this.callsOutputAggregate = true;
      this.outputAggregateLocation ??= node.location;
    }
    if (INPUT_AGGREGATE_FUNCTIONS.has(name)) {
      this.callsInputAggregate = true;
    }
    if (CODESCRIPT_COUNT_FUNCTIONS.has(name)) {
      this.callsCodeScriptCount = true;
    }
    if (SIGNATURE_CHECK_FUNCTIONS.has(name)) {
      this.callsSignatureCheck = true;
      this.signatureLocation ??= node.location;
    }
    if (PUSH_REF_OPS.has(node.identifier.name)) {
      this.usesPushRef = true;
      this.introspectsAnything = true;
    }
    return super.visitFunctionCall(node);
  }

  visitBinaryOp(node: BinaryOpNode): Node {
    // tx.inputs.length compared to a constant in a way that FORBIDS the 2-input
    // co-spend (== 1, <= 1, < 2) => a real anti-merge bound (F-4). A vacuous guard
    // like `tx.inputs.length >= 1` (always true) does NOT defeat the co-spend
    // footgun and must NOT clear per-active-input-conservation.
    if (isComparison(node.operator) && forbidsTwoInputCospend(node)) {
      this.constrainsInputCount = true;
    }

    // Output-set shape: bound, per-index recipient/script pins, nulldata destroy.
    this.collectOutputShape(node);

    // L-1: record which output index the code-continuity pin and each next-state
    // binding target, so a state bound to a DIFFERENT index than the carrier fires.
    this.collectContinuityIndices(node);

    // L-2: record which forwarded refs have their output containment pinned
    // (refOutputCount(ref) vs a constant, or a codeScriptCount == refOutputCount
    // carrier stitch).
    this.collectRefContainment(node);

    // Conservation structure is read off `==` comparisons only.
    if (node.operator === BinaryOperator.EQ) {
      const leftAgg = this.aggregateRefOf(node.left);
      const rightAgg = this.aggregateRefOf(node.right);

      // Balanced *ValueSum identity (KEY-AWARE, F-1): an input-side *ValueSum on one
      // side and an output-side *ValueSum on the other, BOTH keyed off the SAME
      // (non-opaque) key. A mismatched or spender-opaque key conserves nothing about
      // the real value pool, so it is NOT a conservation identity — fail safe toward
      // warning when keys do not provably match.
      if (isBalancedValueSum(leftAgg, rightAgg)) {
        this.hasBalancedValueSum = true;
      }

      // Balanced *Count identity (carrier stitch, F-2): a count aggregate on BOTH
      // sides. This is the FungibleToken `codeScriptCount(csh) == refOutputCount(ref)`
      // stitch — DIFFERENT kinds with DIFFERENT keys, but together they assert "every
      // ref carrier is a code carrier". A count equality is a STRUCTURAL-count claim,
      // so it is valid regardless of X vs Y and clears aggregate-only /
      // unconstrained-outputs. It deliberately does NOT feed value conservation (a
      // count says nothing about value), which is enforced by checkMissingValue
      // Conservation reading only hasBalancedValueSum / hasInputOutputValueRelation.
      const leftCount = leftAgg?.kind === 'IN_COUNT' || leftAgg?.kind === 'OUT_COUNT';
      const rightCount = rightAgg?.kind === 'IN_COUNT' || rightAgg?.kind === 'OUT_COUNT';
      if (leftCount && rightCount) {
        this.hasBalancedCount = true;
      }

      // Input-vs-output VALUE relation: the union of both sides relates an input
      // value source to an output value source. Covers the balanced-sum identity,
      // the Vault `out0 + out1 + fee == inputValue`, and the burn `in - x == out`.
      // This is the per-index / arithmetic value-accounting path; the balanced
      // *ValueSum aggregate identity above is the supply-conservation path. We
      // additionally require, when BOTH sides are pure aggregates, that they share a
      // key — otherwise a mismatched-key aggregate==aggregate must not count as a
      // value relation (it is the F-1 leak, not real accounting).
      if (
        relatesInputToOutputValue(node, this.localTokens)
        && !mismatchedKeyAggregatePair(leftAgg, rightAgg)
      ) {
        this.hasInputOutputValueRelation = true;
      }
    }

    // carriesRefForward: an OUTPUT-side ref/code count aggregate asserted to a
    // POSITIVE carrier count (== n>0, or >= n>0) means the ref/covenant survives
    // into an output. A count == 0 is the OPPOSITE (deliberate retirement).
    if (node.operator === BinaryOperator.EQ || node.operator === BinaryOperator.GE) {
      const side = countAggregateSide(node.left, node.right);
      if (
        side
        && OUTPUT_AGGREGATE_FUNCTIONS.has(side.aggregateNode.identifier.name as GlobalFunction)
        && side.constant !== undefined
        && side.constant > 0n
      ) {
        this.carriesRefForward = true;
      }
    }

    // continuity-count-trivial: a *Count aggregate compared to a constant that
    // permits no carry-forward (== 0, or >= 0 which is always true).
    this.checkTrivialContinuity(node);

    return super.visitBinaryOp(node);
  }

  // Read the output-set shape off comparison nodes:
  //   tx.outputs.length == N            -> outputCountBound
  //   tx.outputs[i].lockingBytecode == ../ codeScript == ../ stateScript == ..
  //                                      -> pinnedOutputIndices (recipient/script pin)
  //   tx.outputs[i].lockingBytecode == new LockingBytecodeNullData(..)
  //                                      -> pinsNullDataOutput (provable destruction)
  private collectOutputShape(node: BinaryOpNode): void {
    // Output-count bound.
    if (node.operator === BinaryOperator.EQ) {
      const left = node.left;
      const right = node.right;
      if (left instanceof NullaryOpNode && left.operator === NullaryOperator.OUTPUT_COUNT) {
        const n = asIntLiteral(right);
        if (n !== undefined) this.outputCountBound = n;
      } else if (right instanceof NullaryOpNode && right.operator === NullaryOperator.OUTPUT_COUNT) {
        const n = asIntLiteral(left);
        if (n !== undefined) this.outputCountBound = n;
      }
    }

    // Per-index recipient/script/state pin (an equality whose one side is an
    // output recipient/script/state field at a literal index).
    if (node.operator === BinaryOperator.EQ) {
      const pinnedLeft = outputPinIndex(node.left);
      const pinnedRight = outputPinIndex(node.right);
      const index = pinnedLeft ?? pinnedRight;
      if (index !== undefined) {
        this.pinnedOutputIndices.add(index);
        // Provable destruction: the pinned recipient is a nulldata (OP_RETURN),
        // either inline (`== new LockingBytecodeNullData(..)`) or via a local
        // bound to one (`bytes nd = new ...; outputs[i]... == nd`).
        const other = pinnedLeft !== undefined ? node.right : node.left;
        if (
          containsNullDataInstantiation(other)
          || (other instanceof IdentifierNode && this.nullDataLocals.has(other.name))
        ) {
          this.pinsNullDataOutput = true;
        }
      }
    }
  }

  // L-1: read the literal output index off the code-continuity pin and each
  // next-state binding.
  //   tx.outputs[i].codeScript  == ..   -> codeScriptPinIndices
  //   tx.outputs[j].stateScript == ..   -> stateBindIndices (+ first location)
  private collectContinuityIndices(node: BinaryOpNode): void {
    if (node.operator !== BinaryOperator.EQ) return;
    const codePin = fieldIndexOf(node.left, UnaryOperator.OUTPUT_CODESCRIPTBYTECODE)
      ?? fieldIndexOf(node.right, UnaryOperator.OUTPUT_CODESCRIPTBYTECODE);
    if (codePin !== undefined) this.codeScriptPinIndices.add(codePin);

    const statePinLeft = fieldIndexOf(node.left, UnaryOperator.OUTPUT_STATESCRIPTBYTECODE);
    const statePinRight = fieldIndexOf(node.right, UnaryOperator.OUTPUT_STATESCRIPTBYTECODE);
    const statePin = statePinLeft ?? statePinRight;
    if (statePin !== undefined) {
      this.stateBindIndices.add(statePin);
      const loc = (statePinLeft !== undefined ? node.left : node.right).location ?? node.location;
      if (loc && !this.stateBindLocationByIndex.has(statePin)) {
        this.stateBindLocationByIndex.set(statePin, loc);
      }
    }
  }

  // L-2: mark a forwarded ref as CONTAINED when its output containment is pinned:
  //   refOutputCount(ref) <op> <int literal>        -> ref contained
  //   codeScriptCount(csh) == refOutputCount(ref)   -> ref contained (carrier stitch)
  private collectRefContainment(node: BinaryOpNode): void {
    if (!isComparison(node.operator)) return;

    // refOutputCount(ref) compared to a CONSTANT (any literal — even == 0, which is
    // the deliberate-melt retirement; the ref's output count is still constrained).
    const left = node.left;
    const right = node.right;
    const refCountLeft = asRefOutputCount(left);
    const refCountRight = asRefOutputCount(right);
    if (refCountLeft && asIntLiteral(right) !== undefined) {
      const fp = this.refFingerprintOf(refCountLeft.parameters[0]);
      if (fp !== undefined) this.containedRefs.add(fp);
    }
    if (refCountRight && asIntLiteral(left) !== undefined) {
      const fp = this.refFingerprintOf(refCountRight.parameters[0]);
      if (fp !== undefined) this.containedRefs.add(fp);
    }

    // codeScriptCount(csh) == refOutputCount(ref) carrier stitch: a count aggregate
    // on one side and refOutputCount(ref) on the other ties every ref carrier to a
    // code carrier, so the ref's output containment IS constrained.
    if (node.operator === BinaryOperator.EQ) {
      const stitchRef = (refCountLeft && asCountAggregate(right))
        ? refCountLeft
        : ((refCountRight && asCountAggregate(left)) ? refCountRight : undefined);
      if (stitchRef) {
        const fp = this.refFingerprintOf(stitchRef.parameters[0]);
        if (fp !== undefined) this.containedRefs.add(fp);
      }
    }
  }

  private checkTrivialContinuity(node: BinaryOpNode): void {
    const aggregateSide = countAggregateSide(node.left, node.right);
    if (!aggregateSide) return;
    const { aggregateNode, constant } = aggregateSide;
    if (constant === undefined) return;
    // Normalise to `count <op> constant` (the aggregate is consensus-non-negative).
    // The aggregate is on the LEFT when node.left is the aggregate; otherwise the
    // comparison is mirrored (`k OP count` reads as `count flip(OP) k`).
    const aggregateOnLeft = asCountAggregate(node.left) !== undefined;
    const op = aggregateOnLeft ? node.operator : flipComparison(node.operator);
    if (op !== undefined && isVacuousCountConstraint(op, constant)) {
      this.trivialContinuityLocation ??= aggregateNode.location ?? node.location;
    }
  }
}

// Flip a comparison operator so `k OP count` can be re-read as `count flip(OP) k`.
function flipComparison(op: BinaryOperator): BinaryOperator | undefined {
  switch (op) {
    case BinaryOperator.LT: return BinaryOperator.GT;
    case BinaryOperator.LE: return BinaryOperator.GE;
    case BinaryOperator.GT: return BinaryOperator.LT;
    case BinaryOperator.GE: return BinaryOperator.LE;
    case BinaryOperator.EQ: return BinaryOperator.EQ;
    case BinaryOperator.NE: return BinaryOperator.NE;
    default: return undefined;
  }
}

// Given a count constraint normalised to `count <op> k` where count is known to
// be consensus-non-negative (count >= 0), is the constraint VACUOUS — i.e. it
// pins count to 0 (nothing carried forward) or it is always true (every count
// >= 0 satisfies it)? It is SOUND only when it FORCES a strictly-positive count.
//   - count == 0  / count < 1  / count <= 0        -> means count == 0  (vacuous)
//   - count >= 0  / count > -1 / count != -1       -> always true       (vacuous)
//   - count == N (N>=1) / count >= 1 / count > 0    -> SOUND continuity
function isVacuousCountConstraint(op: BinaryOperator, k: bigint): boolean {
  switch (op) {
    // Equality pins exactly k: only k==0 is vacuous; k>=1 is real continuity.
    case BinaryOperator.EQ: return k === 0n;
    // count < k with count>=0 collapses to "count == 0" exactly when k == 1 (and is
    // unsatisfiable for k<=0). `< 1` is the canonical vacuous form.
    case BinaryOperator.LT: return k === 1n;
    // count <= 0 pins count to 0 (count>=0). Higher k is a loose upper bound we do
    // not treat as a continuity assertion either way; only `<= 0` is the footgun.
    case BinaryOperator.LE: return k === 0n;
    // count >= k forces a positive count only when k>=1 (SOUND). k<=0 is always true.
    case BinaryOperator.GE: return k <= 0n;
    // count > k forces a positive count only when k>=0 -> count>=k+1>=1 (SOUND).
    // k<0 (e.g. > -1) is always true -> vacuous.
    case BinaryOperator.GT: return k < 0n;
    // count != k is always true when k<0 (count can never be negative) -> vacuous.
    // (k>=0 excludes one value but does not assert continuity; not flagged here.)
    case BinaryOperator.NE: return k < 0n;
    default: return false;
  }
}

// True when an index expression is `this.activeInputIndex`.
function indexesActiveInput(node: Node | undefined): boolean {
  return node instanceof NullaryOpNode && node.operator === NullaryOperator.INPUT_INDEX;
}

function isComparison(op: BinaryOperator): boolean {
  return op === BinaryOperator.EQ || op === BinaryOperator.NE
    || op === BinaryOperator.LT || op === BinaryOperator.LE
    || op === BinaryOperator.GT || op === BinaryOperator.GE;
}

function referencesInputCount(node: ExpressionNode): boolean {
  return node instanceof NullaryOpNode && node.operator === NullaryOperator.INPUT_COUNT;
}

// True when a comparison on `tx.inputs.length` FORBIDS the 2-input co-spend — the
// only kind of input-count bound that defeats the per-active-input co-spend
// footgun (F-4). Normalised to `inputs.length <op> k`, that is exactly:
//   == 1   (precisely one input)
//   <= 1   (at most one input)
//   < 2    (at most one input)
// A `>=`, `>`, `!=`, or `== N` (N>=2) does NOT forbid two inputs and is rejected.
function forbidsTwoInputCospend(node: BinaryOpNode): boolean {
  const leftIsCount = referencesInputCount(node.left);
  const rightIsCount = referencesInputCount(node.right);
  if (leftIsCount === rightIsCount) return false; // need exactly one count side
  const k = asIntLiteral(leftIsCount ? node.right : node.left);
  if (k === undefined) return false;
  // Normalise so the operator reads as `inputs.length <op> k`.
  const op = leftIsCount ? node.operator : flipComparison(node.operator);
  switch (op) {
    case BinaryOperator.EQ: return k === 1n;
    case BinaryOperator.LE: return k <= 1n;
    case BinaryOperator.LT: return k <= 2n;
    default: return false;
  }
}

// If exactly one side of a binary op is a *Count aggregate call and the other is
// an integer literal, return both; otherwise undefined.
function countAggregateSide(
  left: ExpressionNode,
  right: ExpressionNode,
): { aggregateNode: FunctionCallNode; constant: bigint | undefined } | undefined {
  const leftAgg = asCountAggregate(left);
  const rightAgg = asCountAggregate(right);
  if (leftAgg && !rightAgg) return { aggregateNode: leftAgg, constant: asIntLiteral(right) };
  if (rightAgg && !leftAgg) return { aggregateNode: rightAgg, constant: asIntLiteral(left) };
  return undefined;
}

function asCountAggregate(node: ExpressionNode): FunctionCallNode | undefined {
  if (node instanceof FunctionCallNode && COUNT_FUNCTIONS.has(node.identifier.name as GlobalFunction)) {
    return node;
  }
  return undefined;
}

function asIntLiteral(node: ExpressionNode): bigint | undefined {
  // IntLiteralNode stores `value: bigint` but importing it would widen the
  // import surface; duck-type on the shape instead.
  const value = (node as { value?: unknown }).value;
  return typeof value === 'bigint' ? value : undefined;
}

// Per-index recipient/script/state pin fields — pinning one of these constrains
// WHERE an output's value goes (a value-only pin does not, since the skim could
// target a different output).
const OUTPUT_DESTINATION_PIN_OPS: ReadonlySet<UnaryOperator> = new Set([
  UnaryOperator.OUTPUT_LOCKING_BYTECODE,
  UnaryOperator.OUTPUT_CODESCRIPTBYTECODE,
  UnaryOperator.OUTPUT_STATESCRIPTBYTECODE,
]);

// If `node` is `tx.outputs[i].lockingBytecode/.codeScript/.stateScript` at a
// LITERAL index i, return i; otherwise undefined.
function outputPinIndex(node: ExpressionNode): number | undefined {
  if (node instanceof UnaryOpNode && OUTPUT_DESTINATION_PIN_OPS.has(node.operator)) {
    const index = asIntLiteral(node.expression);
    if (index !== undefined) return Number(index);
  }
  return undefined;
}

// If `node` is `tx.outputs[i].<op>` at a LITERAL index i for the SPECIFIC output
// field `op` (e.g. OUTPUT_CODESCRIPTBYTECODE / OUTPUT_STATESCRIPTBYTECODE), return
// i; otherwise undefined. Used by L-1 to separate code-pin indices from
// state-bind indices.
function fieldIndexOf(node: ExpressionNode, op: UnaryOperator): number | undefined {
  if (node instanceof UnaryOpNode && node.operator === op) {
    const index = asIntLiteral(node.expression);
    if (index !== undefined) return Number(index);
  }
  return undefined;
}

// If `node` is a `tx.outputs.refOutputCount(ref)` call, return it; otherwise
// undefined. (Only the OUTPUT-side refOutputCount constrains OUTPUT containment;
// the input-side aggregate says nothing about where the ref lands in outputs.)
function asRefOutputCount(node: ExpressionNode): FunctionCallNode | undefined {
  if (
    node instanceof FunctionCallNode
    && (node.identifier.name === GlobalFunction.REFOUTPUTCOUNT_OUTPUTS
      || node.identifier.name === GlobalFunction.REFOUTPUTCOUNTZEROVALUED_OUTPUTS)
  ) {
    return node;
  }
  return undefined;
}

// True when a subtree instantiates `new LockingBytecodeNullData(...)` — i.e. it
// builds a provably-unspendable OP_RETURN, the signature of a burn/melt.
function containsNullDataInstantiation(node: Node): boolean {
  let found = false;
  const visit = (n: Node | undefined): void => {
    if (!n || found) return;
    if (n instanceof InstantiationNode && n.identifier.name === Class.LOCKING_BYTECODE_NULLDATA) {
      found = true;
      return;
    }
    Object.values(n).forEach((value) => {
      if (value instanceof Node) visit(value);
      else if (Array.isArray(value)) value.forEach((v) => { if (v instanceof Node) visit(v); });
    });
  };
  visit(node);
  return found;
}

// ---------------------------------------------------------------------------
// Dead-store detection
//
// The compiler already hard-errors (UnusedVariableError) on a local that is
// NEVER referenced at all, so this only needs to catch the subtler footgun: a
// value-typed local/state var whose LAST write has no subsequent *meaningful*
// read — the classic `newCount = currentCount + 1`-but-never-enforced state
// transition.
//
// A read only counts as meaningful when the value flows into a real constraint:
// an output binding (`tx.outputs[i].stateScript == x`) or a covenant aggregate
// (its argument). A tautology (`require(x == x)`) or a trivially-true / non-output
// guard (`require(x > 0)`) does NOT rescue a dead computed value, because it does
// not bind the value into the transaction shape.
//
// We walk statements in source order, recording for each name the index of its
// last write and the index of its last *meaningful* read. A name is a dead store
// when it has a write but no meaningful read at a strictly later statement index.
// ---------------------------------------------------------------------------

interface DeadStore {
  name: string;
  location?: Location;
}

class IdentifierUseCollector extends AstTraversal {
  // Names read inside a context that genuinely binds them into the transaction:
  // an output-field binding comparison, a value-conservation relation, or a
  // covenant aggregate argument. Only these rescue a computed value from being a
  // dead store (a tautology or trivial guard does not).
  meaningfulReads: Set<string> = new Set();

  visitBinaryOp(node: BinaryOpNode): Node {
    // An equality/relation that BINDS an output field counts every identifier on
    // the *other* side as a meaningful read (the value is pinned to that output).
    if (isComparison(node.operator)) {
      const leftOut = containsOutputField(node.left);
      const rightOut = containsOutputField(node.right);
      if (leftOut && !rightOut) namesIn(node.right).forEach((n) => this.meaningfulReads.add(n));
      if (rightOut && !leftOut) namesIn(node.left).forEach((n) => this.meaningfulReads.add(n));
    }
    // An EQUALITY/INEQUALITY against a CONCRETE value (`count == 5`, `a != b`)
    // genuinely PINS the computed value, so it is meaningfully used. We exclude:
    //   - self-tautologies (`x == x`), which constrain nothing, and
    //   - range guards (`>`, `>=`, `<`, `<=`), the trivially-true / non-binding
    //     case the strengthened rule must still flag (e.g. extra2's `count > 0`).
    if (
      (node.operator === BinaryOperator.EQ || node.operator === BinaryOperator.NE)
      && !isSelfTautology(node)
    ) {
      namesIn(node.left).forEach((n) => this.meaningfulReads.add(n));
      namesIn(node.right).forEach((n) => this.meaningfulReads.add(n));
    }
    return super.visitBinaryOp(node);
  }

  visitFunctionCall(node: FunctionCallNode): Node {
    // A value passed as an argument to a covenant aggregate (e.g. a code-script
    // hash fed to codeScriptValueSum) is genuinely used.
    if (ALL_AGGREGATE_FUNCTIONS.has(node.identifier.name as GlobalFunction)) {
      node.parameters.forEach((p) => namesIn(p).forEach((n) => this.meaningfulReads.add(n)));
    }
    return super.visitFunctionCall(node);
  }
}

// True for a self-tautology like `x == x` — the same single identifier on both
// sides, which constrains nothing and so does not rescue a dead computed value.
function isSelfTautology(node: BinaryOpNode): boolean {
  if (node.left instanceof IdentifierNode && node.right instanceof IdentifierNode) {
    return node.left.name === node.right.name;
  }
  return false;
}

// Collect the identifier names referenced anywhere in a subtree.
function namesIn(node: Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: Node | undefined): void => {
    if (!n) return;
    if (n instanceof IdentifierNode) names.add(n.name);
    Object.values(n).forEach((value) => {
      if (value instanceof Node) visit(value);
      else if (Array.isArray(value)) value.forEach((v) => { if (v instanceof Node) visit(v); });
    });
  };
  visit(node);
  return names;
}

// True when a subtree reads any per-index OUTPUT field (so an `==` against it is
// an output binding).
function containsOutputField(node: Node): boolean {
  let found = false;
  const visit = (n: Node | undefined): void => {
    if (!n || found) return;
    if (n instanceof UnaryOpNode && OUTPUT_FIELD_UNARY_OPS.has(n.operator)) {
      found = true;
      return;
    }
    Object.values(n).forEach((value) => {
      if (value instanceof Node) visit(value);
      else if (Array.isArray(value)) value.forEach((v) => { if (v instanceof Node) visit(v); });
    });
  };
  visit(node);
  return found;
}

interface UseEntry {
  lastWrite: number;
  lastRead: number;
  location?: Location;
  valueTyped: boolean;
}

function findDeadStores(statements: StatementNode[]): DeadStore[] {
  const info = new Map<string, UseEntry>();

  const ensure = (name: string): UseEntry => {
    let entry = info.get(name);
    if (!entry) {
      entry = { lastWrite: -1, lastRead: -1, valueTyped: false };
      info.set(name, entry);
    }
    return entry;
  };

  statements.forEach((statement, index) => {
    // Record the write side first (definitions / assignment targets at this
    // statement), then the read side from a sub-traversal of the statement.
    if (statement instanceof VariableDefinitionNode && isValueType(statement.type)) {
      const entry = ensure(statement.name);
      entry.lastWrite = index;
      entry.location = statement.location;
      entry.valueTyped = true;
    } else if (statement instanceof AssignNode) {
      const targetType = statement.identifier.type ?? statement.identifier.definition?.type;
      if (isValueType(targetType)) {
        const entry = ensure(statement.identifier.name);
        entry.lastWrite = index;
        entry.location ??= statement.location;
        entry.valueTyped = true;
      }
    }

    const uses = new IdentifierUseCollector();
    uses.visit(statement);
    // Only a MEANINGFUL read (output binding / aggregate argument) keeps a
    // computed value alive — a tautology or trivial guard does not.
    uses.meaningfulReads.forEach((name) => {
      const entry = ensure(name);
      entry.lastRead = index;
    });
  });

  const dead: DeadStore[] = [];
  info.forEach((entry, name) => {
    if (entry.valueTyped && entry.lastWrite >= 0 && entry.lastRead <= entry.lastWrite) {
      dead.push({ name, location: entry.location });
    }
  });
  return dead;
}

// ---------------------------------------------------------------------------
// Rule identifiers (stable strings used by suppression directives)
//
// This object is the SINGLE SOURCE OF TRUTH for canonical rule names; the
// suppression parser imports `LINT_RULE_NAMES` from here so an unknown rule in a
// directive can be diagnosed and the two can never drift apart.
// ---------------------------------------------------------------------------

export const LintRule = {
  UNCONSTRAINED_OUTPUTS: 'unconstrained-outputs',
  DEAD_COMPUTED_VALUE: 'dead-computed-value',
  AGGREGATE_ONLY: 'aggregate-only',
  MISSING_CONTINUITY: 'missing-continuity',
  AUTH_ONLY_SPEND: 'auth-only-spend',
  MISSING_VALUE_CONSERVATION: 'missing-value-conservation',
  PER_ACTIVE_INPUT_CONSERVATION: 'per-active-input-conservation',
  CONTINUITY_COUNT_TRIVIAL: 'continuity-count-trivial',
  STATE_BOUND_TO_NONCARRIER: 'state-bound-to-noncarrier',
  FORWARDED_REF_UNCONTAINED: 'forwarded-ref-uncontained',
} as const;

// The canonical set of rule names, shared with LintSuppressions so a directive
// naming an unknown rule can be flagged.
export const LINT_RULE_NAMES: ReadonlySet<string> = new Set(Object.values(LintRule));

// ---------------------------------------------------------------------------
// Top-level lint traversal
// ---------------------------------------------------------------------------

export default class CovenantLintTraversal extends AstTraversal {
  warnings: LintWarning[] = [];

  visitContract(node: ContractNode): Node {
    // Multi-clause contracts: lint each function clause.
    node.functions.forEach((fn) => this.lintFunction(fn));

    // Single-clause / state-script contracts: the contract-level statement block
    // is its own covenant body. Lint it too.
    if (node.statements.length > 0) {
      this.analyzeBody(node.statements, node.name);
    }

    return node;
  }

  private lintFunction(fn: FunctionDefinitionNode): void {
    const statements = fn.body.statements ?? [];
    this.analyzeBody(statements, fn.name);
  }

  private analyzeBody(statements: StatementNode[], functionName: string): void {
    const collector = new FunctionFactCollector(statements);
    statements.forEach((statement) => collector.visit(statement));

    this.checkUnconstrainedOutputs(collector, functionName);
    this.checkDeadComputedValue(statements, functionName);
    this.checkAggregateOnly(collector, functionName);
    this.checkMissingContinuity(collector, statements, functionName);
    this.checkAuthOnlySpend(collector, statements, functionName);
    this.checkMissingValueConservation(collector, functionName);
    this.checkPerActiveInputConservation(collector, functionName);
    this.checkTrivialContinuity(collector, functionName);
    this.checkStateBoundToNoncarrier(collector, functionName);
    this.checkForwardedRefUncontained(collector, functionName);
  }

  // unconstrained-outputs: introspects an output (per-index field OR output-side
  // aggregate) but never constrains tx.outputs.length.
  //
  // REFINEMENT (#5): a balanced conservation identity (an *ValueSum or *Count
  // aggregate on BOTH sides of the same `==`) accounts for the whole output set
  // regardless of its size, so an open output count is sound — do not fire.
  private checkUnconstrainedOutputs(c: FunctionFactCollector, functionName: string): void {
    const introspectsOutput = c.introspectsOutputField || c.callsOutputAggregate;
    const hasBalancedIdentity = c.hasBalancedValueSum || c.hasBalancedCount;
    if (introspectsOutput && !c.readsOutputCount && !hasBalancedIdentity) {
      this.warnings.push({
        rule: LintRule.UNCONSTRAINED_OUTPUTS,
        message: 'outputs are introspected but tx.outputs.length is never constrained '
          + '— the output set is open-ended (attacker can add outputs).',
        ...locationOf(c.outputFieldLocation ?? c.outputAggregateLocation, functionName),
      });
    }
  }

  // dead-computed-value: a value-typed local/state var whose last write is never
  // subsequently bound into an output / covenant aggregate.
  private checkDeadComputedValue(statements: StatementNode[], functionName: string): void {
    findDeadStores(statements).forEach((dead) => {
      this.warnings.push({
        rule: LintRule.DEAD_COMPUTED_VALUE,
        message: `value \`${dead.name}\` is computed but never used in a require() or bound to an `
          + 'output — the intended constraint is missing (e.g. a state transition that is '
          + 'never enforced).',
        ...locationOf(dead.location, functionName),
      });
    });
  }

  // aggregate-only: calls a ref/code-script aggregate but never pins a specific
  // output field (so nothing proves which output carries the ref).
  //
  // REFINEMENT (#5): a balanced conservation identity ties the aggregate to its
  // counterpart aggregate (e.g. codeScriptCount == refOutputCount, or
  // codeScriptValueSum(in) == codeScriptValueSum(out)), which is the sound
  // fan-out pattern — do not fire.
  private checkAggregateOnly(c: FunctionFactCollector, functionName: string): void {
    const hasBalancedIdentity = c.hasBalancedValueSum || c.hasBalancedCount;
    if (c.callsAnyAggregate && !c.introspectsOutputField && !hasBalancedIdentity) {
      this.warnings.push({
        rule: LintRule.AGGREGATE_ONLY,
        message: 'a ref/code-script aggregate is checked but no specific output is pinned '
          + '(tx.outputs[i].value/.lockingBytecode) — there is no opcode proving which output '
          + 'carries the ref, so tie the aggregate to a pinned output.',
        ...locationOf(c.anyAggregateLocation, functionName),
      });
    }
  }

  // missing-continuity: reads its own code script but never asserts codeScriptCount.
  private checkMissingContinuity(
    c: FunctionFactCollector,
    statements: StatementNode[],
    functionName: string,
  ): void {
    if (c.readsOwnCodeScript && !c.callsCodeScriptCount) {
      this.warnings.push({
        rule: LintRule.MISSING_CONTINUITY,
        message: 'the covenant reads its own code script but never asserts codeScriptCount(...) '
          + '— the covenant may not be carried forward (it can escape into a different/no '
          + 'script).',
        ...locationOf(c.ownCodeScriptLocation, functionName, statements),
      });
    }
  }

  // auth-only-spend: authenticates a signature but constrains no outputs/inputs/
  // refs/code script at all.
  private checkAuthOnlySpend(
    c: FunctionFactCollector,
    statements: StatementNode[],
    functionName: string,
  ): void {
    if (c.callsSignatureCheck && !c.introspectsAnything) {
      this.warnings.push({
        rule: LintRule.AUTH_ONLY_SPEND,
        message: 'the function authenticates a signature but constrains no outputs — once '
          + 'authorised, the spent funds can go anywhere (this is only safe if the signer fully '
          + 'controls the transaction).',
        ...locationOf(c.signatureLocation, functionName, statements),
      });
    }
  }

  // missing-value-conservation (HEADLINE GAP): the covenant introspects outputs
  // and/or forwards a ref (pinning WHERE value goes) but never relates input value
  // to output value — so an attacker can satisfy the destination pins while
  // skimming value (leak/mint). A value relation is ANY of: a balanced *ValueSum
  // identity, an input-vs-output value comparison, or a burn-style `in - x == out`.
  private checkMissingValueConservation(c: FunctionFactCollector, functionName: string): void {
    // Only covenants that pin a destination (constrain WHERE value goes) need a
    // value relation; an auth-only / shape-free spend is handled elsewhere.
    const constrainsDestination = c.pinsOutputField || c.usesPushRef || c.callsOutputAggregate;
    const hasValueRelation = c.hasBalancedValueSum || c.hasInputOutputValueRelation;

    // CONSERVATIVE EXCEPTION — a BOUNDED SWEEP needs no value relation: when the
    // output set is bounded to N (tx.outputs.length == N), every one of those N
    // outputs is pinned to a fixed recipient/script, and NO ref survives into an
    // output (so this isn't a covenant carry-forward), there is no unpinned skim
    // channel — the whole value goes to the pinned recipients (less fee). This is
    // the melt / emergencyRecover shape. fn1 (length==2, only out[0] pinned) and
    // fn9 (carries a ref forward) are NOT bounded sweeps and still fire.
    const bound = c.outputCountBound;
    const fullyPinnedSweep = bound !== undefined
      && bound > 0n
      && everyIndexPinned(c.pinnedOutputIndices, Number(bound))
      && !c.carriesRefForward;

    if (constrainsDestination && !hasValueRelation && !fullyPinnedSweep) {
      this.warnings.push({
        rule: LintRule.MISSING_VALUE_CONSERVATION,
        message: 'outputs/refs are constrained but input value is never related to output value '
          + '— there is no value-conservation check (e.g. codeScriptValueSum(in) == '
          + 'codeScriptValueSum(out), or inputs[i].value accounted against outputs[i].value), '
          + 'so value can leak or be minted while the destination pins still pass.',
        ...locationOf(
          c.outputFieldLocation ?? c.outputAggregateLocation ?? c.anyAggregateLocation,
          functionName,
        ),
      });
    }
  }

  // per-active-input-conservation: a value/continuity check references
  // tx.inputs[this.activeInputIndex].value WITHOUT a tx-wide input aggregate AND
  // without bounding tx.inputs.length. Two identical covenant UTXOs can then be
  // co-spent against the same shared outputs (each input evaluates independently),
  // so per-active-input conservation passes for both while value is skimmed.
  private checkPerActiveInputConservation(c: FunctionFactCollector, functionName: string): void {
    if (c.readsActiveInputValue && !c.callsInputAggregate && !c.constrainsInputCount) {
      this.warnings.push({
        rule: LintRule.PER_ACTIVE_INPUT_CONSERVATION,
        message: 'tx.inputs[this.activeInputIndex].value is used without a tx-wide input '
          + 'aggregate (codeScriptValueSum/refValueSum) or a tx.inputs.length bound — two '
          + 'identical covenant UTXOs can be CO-SPENT against the same outputs (each input '
          + 'evaluates independently), so the per-active-input check passes for both while a '
          + 'whole input is skimmed. Bound tx.inputs.length or conserve over a tx-wide aggregate.',
        ...locationOf(c.activeInputValueLocation, functionName),
      });
    }
  }

  // continuity-count-trivial: a codeScriptCount/refOutputCount aggregate compared
  // to a constant that permits NO carry-forward (== 0 lets the covenant/ref vanish;
  // >= 0 is always true). Such a "continuity" check enforces nothing.
  //
  // CONSERVATIVE EXCEPTION — a deliberate MELT/BURN legitimately retires a ref
  // with refOutputCount(ref) == 0 while provably destroying the value to an
  // OP_RETURN (new LockingBytecodeNullData). When the function pins a nulldata
  // output, the count==0 is intended retirement, not a continuity footgun. fn9
  // (no nulldata; carries a ref forward with a SEPARATE count==1) still fires.
  private checkTrivialContinuity(c: FunctionFactCollector, functionName: string): void {
    if (c.trivialContinuityLocation && !c.pinsNullDataOutput) {
      this.warnings.push({
        rule: LintRule.CONTINUITY_COUNT_TRIVIAL,
        message: 'a codeScriptCount/refOutputCount continuity check is compared to a constant '
          + 'that carries nothing forward (== 0 permits the covenant/ref to vanish; >= 0 is '
          + 'always true) — assert == 1 (or the intended carrier count) to keep the covenant '
          + 'alive.',
        ...locationOf(c.trivialContinuityLocation, functionName),
      });
    }
  }

  // state-bound-to-noncarrier (L-1): the covenant pins code/value/ref continuity
  // to ONE output index i (`tx.outputs[i].codeScript == ...`) but binds the next
  // state to a DIFFERENT index j (`tx.outputs[j].stateScript == ...`). The real
  // continuation carrier (output[i]) then has its state UNCONSTRAINED while a
  // non-carrier output's state is bound — an attacker can forward an arbitrary
  // (e.g. owner-spoofing) state on the carrier. We fire only when there is a
  // SINGLE code-continuity carrier index (exactly one distinct codeScript-pin
  // index): with multiple code-pin indices we cannot identify the carrier, so we
  // stay silent (conservative). The real FungibleToken/StatefulCounter/SingletonNFT
  // bind state to the SAME index they pin (output[0]) and stay clean.
  private checkStateBoundToNoncarrier(c: FunctionFactCollector, functionName: string): void {
    if (c.codeScriptPinIndices.size !== 1) return;
    const [carrier] = [...c.codeScriptPinIndices];
    c.stateBindIndices.forEach((j) => {
      if (j === carrier) return;
      this.warnings.push({
        rule: LintRule.STATE_BOUND_TO_NONCARRIER,
        message: `code/ref continuity is pinned to output[${carrier}] but the next state is bound `
          + `to output[${j}] (tx.outputs[${j}].stateScript == ...) — the continuation carrier's `
          + 'state is left UNCONSTRAINED while a non-carrier output\'s state is bound, so an '
          + `attacker can forward an arbitrary state on output[${carrier}]. Bind the state on the `
          + `same output index the continuity is pinned to (output[${carrier}]).`,
        ...locationOf(c.stateBindLocationByIndex.get(j), functionName),
      });
    });
  }

  // forwarded-ref-uncontained (L-2): the function forwards a ref via a
  // NON-SINGLETON pushInputRef/requireInputRef but NEVER constrains that ref's
  // OUTPUT containment. Consensus `validatePushRefRule` is only a SUBSET check
  // (output-refs ⊆ input-refs), so a normal forwarded ref MAY appear in EXTRA
  // outputs — an attacker can split it into a foreign (rule-free) script. A ref
  // is contained when its refOutputCount(ref) is compared to a constant (any
  // value — even == 0 for a deliberate melt) OR it appears in a
  // codeScriptCount == refOutputCount(ref) carrier stitch. Singleton forwards are
  // consensus-unique and exempt (they are never recorded as forwarded).
  private checkForwardedRefUncontained(c: FunctionFactCollector, functionName: string): void {
    c.forwardedRefs.forEach((location, fp) => {
      if (c.containedRefs.has(fp)) return;
      this.warnings.push({
        rule: LintRule.FORWARDED_REF_UNCONTAINED,
        message: 'a ref is forwarded via pushInputRef/requireInputRef but its output containment '
          + 'is never pinned (no tx.outputs.refOutputCount(ref) constraint and no '
          + 'codeScriptCount == refOutputCount(ref) stitch) — the push-ref consensus rule is only '
          + 'a subset check (output-refs ⊆ input-refs), so the forwarded ref is not contained and '
          + 'can be SPLIT into an extra foreign (rule-free) script. Assert '
          + 'tx.outputs.refOutputCount(ref) (== 1, or == 0 to retire it).',
        ...locationOf(location, functionName),
      });
    });
  }
}

// True when every output index 0..n-1 appears in `pinned` (the whole bounded
// output set is destination-pinned, leaving no unpinned skim channel).
function everyIndexPinned(pinned: Set<number>, n: number): boolean {
  for (let i = 0; i < n; i += 1) {
    if (!pinned.has(i)) return false;
  }
  return true;
}

// Resolve a warning's line/column from the best available source location:
// the specific node location, falling back to the first statement of the body,
// finally to (0, 0).
function locationOf(
  location: Location | undefined,
  functionName: string,
  fallbackStatements: StatementNode[] = [],
): { line: number; column: number; functionName: string } {
  const point = location?.start ?? fallbackStatements[0]?.location?.start;
  return { line: point?.line ?? 0, column: point?.column ?? 0, functionName };
}
