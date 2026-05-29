import {
  OpcodesBCH,
  encodeDataPush,
  parseBytecode,
  serializeAuthenticationInstructions,
  AuthenticationInstructions,
  hexToBin,
  disassembleBytecodeBCH,
  flattenBinArray,
} from '@bitauth/libauth';
import { decodeInt, encodeInt } from './data.js';
import OptimisationsEquivFile from './cashproof-optimisations.js';

export const Op = OpcodesBCH;
export type Op = number;
export type OpOrData = Op | Uint8Array;
export type Script = OpOrData[];

// TODO: Replace this when these opcodes are in Libauth
export enum IntrospectionOp {
  OP_INPUTINDEX = 192,
  OP_ACTIVEBYTECODE = 193,
  OP_TXVERSION = 194,
  OP_TXINPUTCOUNT = 195,
  OP_TXOUTPUTCOUNT = 196,
  OP_TXLOCKTIME = 197,
  OP_UTXOVALUE = 198,
  OP_UTXOBYTECODE = 199,
  OP_OUTPOINTTXHASH = 200,
  OP_OUTPOINTINDEX = 201,
  OP_INPUTBYTECODE = 202,
  OP_INPUTSEQUENCENUMBER = 203,
  OP_OUTPUTVALUE = 204,
  OP_OUTPUTBYTECODE = 205,
}

export const introspectionOpMapping: any = {
  OP_INPUTINDEX: 'OP_UNKNOWN192',
  OP_ACTIVEBYTECODE: 'OP_UNKNOWN193',
  OP_TXVERSION: 'OP_UNKNOWN194',
  OP_TXINPUTCOUNT: 'OP_UNKNOWN195',
  OP_TXOUTPUTCOUNT: 'OP_UNKNOWN196',
  OP_TXLOCKTIME: 'OP_UNKNOWN197',
  OP_UTXOVALUE: 'OP_UNKNOWN198',
  OP_UTXOBYTECODE: 'OP_UNKNOWN199',
  OP_OUTPOINTTXHASH: 'OP_UNKNOWN200',
  OP_OUTPOINTINDEX: 'OP_UNKNOWN201',
  OP_INPUTBYTECODE: 'OP_UNKNOWN202',
  OP_INPUTSEQUENCENUMBER: 'OP_UNKNOWN203',
  OP_OUTPUTVALUE: 'OP_UNKNOWN204',
  OP_OUTPUTBYTECODE: 'OP_UNKNOWN205',
};

export const reverseIntrospectionOpMapping = Object.fromEntries(
  Object.entries(introspectionOpMapping).map(([k, v]) => ([v, k])),
);

export enum RadiantOp {
  OP_STATESEPARATOR = 0xbd,
  OP_STATESEPARATORINDEX_UTXO = 0xbe,
  OP_STATESEPARATORINDEX_OUTPUT = 0xbf,

  OP_SHA512_256 = 0xce,
  OP_HASH512_256 = 0xcf,

  OP_PUSHINPUTREF = 0xd0,
  OP_REQUIREINPUTREF = 0xd1,
  OP_DISALLOWPUSHINPUTREF = 0xd2,
  OP_DISALLOWPUSHINPUTREFSIBLING = 0xd3,

  OP_REFHASHDATASUMMARY_UTXO = 0xd4,
  OP_REFHASHVALUESUM_UTXOS = 0xd5,
  OP_REFHASHDATASUMMARY_OUTPUT = 0xd6,
  OP_REFHASHVALUESUM_OUTPUTS = 0xd7,

  OP_PUSHINPUTREFSINGLETON = 0xd8,
  OP_REFTYPE_UTXO = 0xd9,
  OP_REFTYPE_OUTPUT = 0xda,

  OP_REFVALUESUM_UTXOS = 0xdb,
  OP_REFVALUESUM_OUTPUTS = 0xdc,
  OP_REFOUTPUTCOUNT_UTXOS = 0xdd,
  OP_REFOUTPUTCOUNT_OUTPUTS = 0xde,
  OP_REFOUTPUTCOUNTZEROVALUED_UTXOS = 0xdf,
  OP_REFOUTPUTCOUNTZEROVALUED_OUTPUTS = 0xe0,
  OP_REFDATASUMMARY_UTXO = 0xe1,
  OP_REFDATASUMMARY_OUTPUT = 0xe2,

  OP_CODESCRIPTHASHVALUESUM_UTXOS = 0xe3,
  OP_CODESCRIPTHASHVALUESUM_OUTPUTS = 0xe4,
  OP_CODESCRIPTHASHOUTPUTCOUNT_UTXOS = 0xe5,
  OP_CODESCRIPTHASHOUTPUTCOUNT_OUTPUTS = 0xe6,
  OP_CODESCRIPTHASHZEROVALUEDOUTPUTCOUNT_UTXOS = 0xe7,
  OP_CODESCRIPTHASHZEROVALUEDOUTPUTCOUNT_OUTPUTS = 0xe8,
  OP_CODESCRIPTBYTECODE_UTXO = 0xe9,
  OP_CODESCRIPTBYTECODE_OUTPUT = 0xea,
  OP_STATESCRIPTBYTECODE_UTXO = 0xeb,
  OP_STATESCRIPTBYTECODE_OUTPUT = 0xec,
  OP_PUSH_TX_STATE = 0xed,

  OP_BLAKE3 = 0xee,
  OP_K12 = 0xef,
}

const radiantOpMapping: any = Object.fromEntries(Object.entries(RadiantOp).map(([k, v]) => ([k, `OP_UNKNOWN${v}`])));

export const reverseRadiantOpMapping = Object.fromEntries(
  Object.entries(radiantOpMapping).map(([k, v]) => ([v, k])),
);

export function scriptToAsm(script: Script): string {
  return bytecodeToAsm(scriptToBytecode(script));
}

export function asmToScript(asm: string): Script {
  return bytecodeToScript(asmToBytecode(asm));
}

export function scriptToBytecode(script: Script): Uint8Array {
  // Convert the script elements to AuthenticationInstructions
  const instructions = script.map((opOrData) => {
    if (typeof opOrData === 'number') {
      return { opcode: opOrData };
    }

    return parseBytecode(encodeDataPush(opOrData))[0];
  });

  // Convert the AuthenticationInstructions to bytecode
  return serializeAuthenticationInstructions(instructions);
}

export function bytecodeToScript(bytecode: Uint8Array): Script {
  // Convert the bytecode to AuthenticationInstructions
  const instructions = parseBytecode(bytecode) as AuthenticationInstructions;

  // Convert the AuthenticationInstructions to script elements
  const script = instructions.map((instruction) => (
    'data' in instruction ? instruction.data : instruction.opcode
  ));

  return script;
}

export function asmToBytecode(asm: string): Uint8Array {
  // Remove any duplicate whitespace
  asm = asm.replace(/\s+/g, ' ').trim();

  // Replace introspection ops with OP_UNKNOWN... so Libauth gets it
  asm = asm.split(' ').map((token) => introspectionOpMapping[token] ?? radiantOpMapping[token] ?? token).join(' ');

  // Convert the ASM tokens to AuthenticationInstructions
  const instructions = asm.split(' ').map((token) => {
    if (token.startsWith('OP_')) {
      return { opcode: Op[token as keyof typeof Op] };
    }

    return parseBytecode(encodeDataPush(hexToBin(token)))[0];
  });

  // Convert the AuthenticationInstructions to bytecode
  return serializeAuthenticationInstructions(instructions);
}

export function bytecodeToAsm(bytecode: Uint8Array): string {
  // Convert the bytecode to libauth's ASM format
  let asm = disassembleBytecodeBCH(bytecode);

  // COnvert libauth's ASM format to BITBOX's
  asm = asm.replace(/OP_PUSHBYTES_[^\s]+/g, '');
  asm = asm.replace(/OP_PUSHDATA[^\s]+ [^\s]+/g, '');
  asm = asm.replace(/(^|\s)0x/g, ' ');

  // Replace OP_UNKNOWN... with the correct ops
  asm = asm.split(' ').map((token) => reverseIntrospectionOpMapping[token] ?? reverseRadiantOpMapping[token] ?? token).join(' ');

  // Remove any duplicate whitespace
  asm = asm.replace(/\s+/g, ' ').trim();

  return asm;
}

export function countOpcodes(script: Script): number {
  return script
    .filter((opOrData) => typeof opOrData === 'number')
    .filter((op) => op > Op.OP_16)
    .length;
}

export function calculateBytesize(script: Script): number {
  return scriptToBytecode(script).byteLength;
}

// For encoding OP_RETURN data (doesn't require BIP62.3 / MINIMALDATA)
export function encodeNullDataScript(chunks: OpOrData[]): Uint8Array {
  return flattenBinArray(
    chunks.map((chunk) => {
      if (typeof chunk === 'number') {
        return new Uint8Array([chunk]);
      }

      const pushdataOpcode = getPushDataOpcode(chunk);
      return new Uint8Array([...pushdataOpcode, ...chunk]);
    }),
  );
}

function getPushDataOpcode(data: Uint8Array): Uint8Array {
  const { byteLength } = data;

  if (byteLength === 0) return Uint8Array.from([0x4c, 0x00]);
  if (byteLength < 76) return Uint8Array.from([byteLength]);
  if (byteLength < 256) return Uint8Array.from([0x4c, byteLength]);
  throw Error('Pushdata too large');
}

/**
 * When cutting out the tx.bytecode preimage variable, the compiler does not know
 * the size of the final redeem scrip yet, because the constructor parameters still
 * need to get added. Because of this it does not know whether the VarInt is 1 or 3
 * bytes. During compilation, an OP_NOP is added at the spot where the bytecode is
 * cut out. This function replaces that OP_NOP and adds either 1 or 3 to the cut to
 * additionally cut off the VarInt.
 *
 * @param script incomplete redeem script
 * @returns completed redeem script
 */
export function replaceBytecodeNop(script: Script): Script {
  // Create a copy to avoid mutating the original
  const scriptCopy = [...script];
  const index = scriptCopy.findIndex((op) => op === Op.OP_NOP);
  if (index < 0) return script;

  // Remove the OP_NOP
  scriptCopy.splice(index, 1);

  // Bounds check: after splicing, index might be out of bounds
  if (index >= scriptCopy.length) {
    return script;
  }

  // Retrieve size of current OP_SPLIT
  let oldCut = scriptCopy[index];
  if (oldCut instanceof Uint8Array) {
    // Validate encoded int bounds
    if (oldCut.length > 8) {
      throw new Error('Encoded integer exceeds maximum byte length');
    }
    oldCut = decodeInt(oldCut);
  } else if (oldCut === Op.OP_0) {
    oldCut = 0;
  } else if (oldCut >= Op.OP_1 && oldCut <= Op.OP_16) {
    oldCut -= 80;
  } else {
    return script;
  }

  // Validate the computed value
  if (oldCut < 0 || oldCut > Number.MAX_SAFE_INTEGER) {
    throw new Error('Invalid cut value: out of safe integer range');
  }

  // Update the old OP_SPLIT by adding either 1 or 3 to it
  scriptCopy[index] = encodeInt(oldCut + 1);
  const bytecodeSize = calculateBytesize(scriptCopy);
  if (bytecodeSize > 252) {
    scriptCopy[index] = encodeInt(oldCut + 3);
  }

  // Minimally encode
  return asmToScript(scriptToAsm(scriptCopy));
}

export function generateRedeemScript(baseScript: Script, encodedArgs: Script): Script {
  return replaceBytecodeNop([...encodedArgs, ...baseScript]);
}

/* ------------------------------------------------------------------ *
 * Opcode-list optimisation pass (audit §3.10)                        *
 *                                                                    *
 * Replaces the legacy `scriptToAsm -> regex -> asmToScript` pipeline.*
 * The audit flagged the regex pass as fragile to future grammar      *
 * additions whose mnemonic is a prefix of another opcode (e.g. a     *
 * careless `.equiv` rule could mis-rewrite). This pass operates      *
 * directly on the opcode list: rules are parsed once at module load  *
 * into structured `(lhs Op[], rhs Op[])` pairs, and match only at    *
 * exact opcode equality (never on data pushes).                      *
 * ------------------------------------------------------------------ */

interface OptimisationRule {
  lhs: Op[];
  rhs: Op[];
  source: string;
}

// Tokens like `OP_NOT`, `OP_1ADD`, ... resolve to opcode numbers via the
// libauth OpcodesBCH enum (re-exported as `Op` above). Radiant- and
// introspection-specific tokens (`OP_STATESEPARATOR`, `OP_INPUTINDEX`,
// ...) are also accepted in case future rules touch them.
function resolveOpcodeToken(token: string): Op {
  const fromBch = (Op as unknown as Record<string, number>)[token];
  if (typeof fromBch === 'number') return fromBch;

  const fromIntrospection = (IntrospectionOp as unknown as Record<string, number>)[token];
  if (typeof fromIntrospection === 'number') return fromIntrospection;

  const fromRadiant = (RadiantOp as unknown as Record<string, number>)[token];
  if (typeof fromRadiant === 'number') return fromRadiant;

  throw new Error(`Unknown opcode token in optimisation rule: "${token}"`);
}

function parseRuleSide(side: string): Op[] {
  const trimmed = side.trim();
  if (trimmed === '') return [];
  return trimmed.split(/\s+/).map(resolveOpcodeToken);
}

function parseOptimisationRules(equivFile: string): OptimisationRule[] {
  // Strip both whole-line and inline `#` comments before joining; the legacy
  // parser only handled whole-line comments, but inline-tolerant is safer.
  const joined = equivFile
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0)
    .join(' ');

  const rules: OptimisationRule[] = [];
  for (const raw of joined.split(';')) {
    const stmt = raw.trim();
    if (stmt === '') continue;
    const parts = stmt.split('<=>');
    if (parts.length !== 2) continue;

    const lhs = parseRuleSide(parts[0]);
    const rhs = parseRuleSide(parts[1]);

    // An empty LHS would match every position and loop forever; reject.
    if (lhs.length === 0) {
      throw new Error(`Optimisation rule has empty LHS: "${stmt}"`);
    }
    // Rules are supposed to shrink (or be size-neutral). A growing rule
    // would not converge in `optimiseBytecode`'s fixed-point loop.
    if (rhs.length > lhs.length) {
      throw new Error(`Optimisation rule would grow script: "${stmt}"`);
    }
    rules.push({ lhs, rhs, source: stmt });
  }
  return rules;
}

// Hardcoded rules that live outside `cashproof-optimisations.equiv`
// because CashProof can't model them (the regex pass kept these inline at
// the bottom of `replaceOps`; we lift them into the same structured form).
//
// The last two `OP_SWAP OP_*VERIFY` rules are not in the original regex
// list — they're the rules the regex pipeline was *accidentally* applying
// via prefix collision (the substring `OP_SWAP OP_EQUAL` matched the
// prefix of `OP_SWAP OP_EQUALVERIFY` after a prior `OP_EQUAL OP_VERIFY`
// merge, silently dropping the redundant SWAP). They're semantically
// valid (EQUAL and NUMEQUAL are commutative, so a SWAP before them is
// a no-op; the VERIFY-merged forms inherit that). Stating them
// explicitly preserves the optimisation without depending on the
// regex's mis-feature.
const HARDCODED_RULES: OptimisationRule[] = [
  { lhs: [Op.OP_NOT, Op.OP_IF], rhs: [Op.OP_NOTIF], source: 'OP_NOT OP_IF <=> OP_NOTIF' },
  { lhs: [Op.OP_CHECKMULTISIG, Op.OP_VERIFY], rhs: [Op.OP_CHECKMULTISIGVERIFY], source: 'OP_CHECKMULTISIG OP_VERIFY <=> OP_CHECKMULTISIGVERIFY' },
  { lhs: [Op.OP_SWAP, Op.OP_AND], rhs: [Op.OP_AND], source: 'OP_SWAP OP_AND <=> OP_AND' },
  { lhs: [Op.OP_SWAP, Op.OP_OR], rhs: [Op.OP_OR], source: 'OP_SWAP OP_OR <=> OP_OR' },
  { lhs: [Op.OP_SWAP, Op.OP_XOR], rhs: [Op.OP_XOR], source: 'OP_SWAP OP_XOR <=> OP_XOR' },
  { lhs: [Op.OP_DUP, Op.OP_AND], rhs: [], source: 'OP_DUP OP_AND <=>' },
  { lhs: [Op.OP_DUP, Op.OP_OR], rhs: [], source: 'OP_DUP OP_OR <=>' },
  { lhs: [Op.OP_SWAP, Op.OP_EQUALVERIFY], rhs: [Op.OP_EQUALVERIFY], source: 'OP_SWAP OP_EQUALVERIFY <=> OP_EQUALVERIFY' },
  { lhs: [Op.OP_SWAP, Op.OP_NUMEQUALVERIFY], rhs: [Op.OP_NUMEQUALVERIFY], source: 'OP_SWAP OP_NUMEQUALVERIFY <=> OP_NUMEQUALVERIFY' },
];

// Parsed at module load. If `OptimisationsEquivFile` contains an unknown
// opcode token, importing this module will throw — that's intentional:
// the audit asked for unknown tokens to be rejected, and a silently
// no-op rule would be worse than a load-time error.
export const OPTIMISATION_RULES: readonly OptimisationRule[] = Object.freeze([
  ...parseOptimisationRules(OptimisationsEquivFile),
  ...HARDCODED_RULES,
]);

// Leftmost, non-overlapping replacement (the same semantics as the
// regex's `g` flag) of `rule.lhs` with `rule.rhs` in `script`. Matches
// only at exact opcode equality and skips data pushes (`Uint8Array`).
// Returns the input reference unchanged if no match was found, so the
// fixed-point loop can compare by identity.
function applyOpcodeListRule(script: Script, rule: OptimisationRule): Script {
  const { lhs, rhs } = rule;
  const result: Script = [];
  let i = 0;
  let changed = false;
  while (i < script.length) {
    if (i + lhs.length <= script.length) {
      let matched = true;
      for (let k = 0; k < lhs.length; k += 1) {
        const element = script[i + k];
        if (typeof element !== 'number' || element !== lhs[k]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        for (const op of rhs) result.push(op);
        i += lhs.length;
        changed = true;
        continue;
      }
    }
    result.push(script[i]);
    i += 1;
  }
  return changed ? result : script;
}

// The codegen emits `encodeInt(0)` for the script-int 0, which produces
// an empty `Uint8Array` rather than the numeric `Op.OP_0`. Both serialize
// to the same byte (0x00), but the rule matcher only equates numbers,
// so an empty-data push and `Op.OP_0` are otherwise indistinguishable
// for optimisation purposes. The legacy regex pipeline papered over this
// by round-tripping through ASM (where libauth's disassembler aliases
// 0x00 to "OP_0"); we do it explicitly here. No other small-int
// (`OP_1`..`OP_16`) needs canonicalisation: their `encodeInt` output is
// a 1-byte push (`[0x01, 0xNN]`), which is *not* bytewise equivalent to
// the corresponding small-int opcode (`OP_N = 0x50 + N`), so the regex
// pipeline never collapsed those either.
function canonicaliseScript(script: Script): Script {
  let changed = false;
  const result: Script = new Array(script.length);
  for (let i = 0; i < script.length; i += 1) {
    const el = script[i];
    if (el instanceof Uint8Array && el.length === 0) {
      result[i] = Op.OP_0;
      changed = true;
    } else {
      result[i] = el;
    }
  }
  return changed ? result : script;
}

// Walks the rule list (cashproof rules first, hardcoded rules last —
// matching the original ordering) and re-runs to a fixed point. `runs`
// caps the iteration count as a runaway safety; reaching it would
// indicate a non-converging rule set (rejected at parse time).
export function optimiseBytecode(script: Script, runs: number = 1000): Script {
  script = canonicaliseScript(script);
  for (let i = 0; i < runs; i += 1) {
    let iterationChanged = false;
    for (const rule of OPTIMISATION_RULES) {
      const next = applyOpcodeListRule(script, rule);
      if (next !== script) {
        script = next;
        iterationChanged = true;
      }
    }
    if (!iterationChanged) break;
  }
  return script;
}
