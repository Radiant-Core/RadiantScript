import { Artifact, LintWarning, asmToBytecode, optimiseBytecode } from '@radiantscript/utils';
import { binToHex, binToUtf8, hexToBin } from '@bitauth/libauth';
import { ANTLRInputStream, CommonTokenStream } from 'antlr4ts';
import fs from 'fs';
import { generateArtifact } from './artifact/Artifact.js';
import { Ast } from './ast/AST.js';
import AstBuilder from './ast/AstBuilder.js';
import ThrowingErrorListener from './ast/ThrowingErrorListener.js';
import GenerateTargetTraversal from './generation/GenerateTargetTraversal.js';
import { CashScriptLexer } from './grammar/CashScriptLexer.js';
import { CashScriptParser } from './grammar/CashScriptParser.js';
import SymbolTableTraversal from './semantic/SymbolTableTraversal.js';
import TypeCheckTraversal from './semantic/TypeCheckTraversal.js';
import EnsureFinalRequireTraversal from './semantic/EnsureFinalRequireTraversal.js';
import CovenantLintTraversal from './semantic/CovenantLintTraversal.js';
import { applySuppressions } from './semantic/LintSuppressions.js';
import { CovenantLintError } from './Errors.js';

// Covenant-lint mode:
//   'off'   -> skip the lint pass entirely.
//   'warn'  -> collect warnings and attach them to the artifact (default).
//   'error' -> throw a CovenantLintError if any (un-suppressed) warning fires.
export type CovenantLintMode = 'off' | 'warn' | 'error';

export interface CompileOptions {
  debug?: boolean;
  covenantLint?: CovenantLintMode;
}

export function compileString(code: string, options: CompileOptions = {}): Artifact {
  // Lexing + parsing
  let ast = parseCode(code);

  // Semantic analysis
  ast = ast.accept(new SymbolTableTraversal()) as Ast;
  ast = ast.accept(new TypeCheckTraversal()) as Ast;
  ast = ast.accept(new EnsureFinalRequireTraversal()) as Ast;

  // Heuristic covenant lint (after the final-require check so we only ever lint
  // structurally-valid contracts). This pass NEVER mutates the AST and — in the
  // default 'warn' mode — NEVER changes compile success: it only collects
  // warnings. They are attached to the returned artifact rather than logged, so
  // compileString stays side-effect-free.
  const lintMode: CovenantLintMode = options.covenantLint ?? 'warn';
  let warnings: LintWarning[] = [];
  if (lintMode !== 'off') {
    const lint = new CovenantLintTraversal();
    ast.accept(lint);
    warnings = applySuppressions(lint.warnings, code);

    if (lintMode === 'error' && warnings.length > 0) {
      throw new CovenantLintError(warnings);
    }
  }

  // Code generation
  const traversal = new GenerateTargetTraversal();
  traversal.debugMode = options.debug ?? false;
  ast = ast.accept(traversal) as Ast;
  const bytecode = traversal.output;
  const sourceMap = traversal.sourceMap;

  // Bytecode optimisation
  const optimisedBytecode = optimiseBytecode(bytecode);

  const artifact = generateArtifact(
    ast,
    optimisedBytecode,
    options.debug ? code : undefined,
    options.debug ? sourceMap : undefined,
  );

  if (warnings.length > 0) {
    artifact.warnings = warnings;
  }

  return artifact;
}

export function compileFile(codeFile: string, options: CompileOptions = {}): Artifact {
  const code = fs.readFileSync(codeFile, { encoding: 'utf-8' });
  return compileString(code, options);
}

export function parseCode(code: string): Ast {
  // Lexing (throwing on errors)
  const inputStream = new ANTLRInputStream(code);
  const lexer = new CashScriptLexer(inputStream);
  lexer.removeErrorListeners();
  lexer.addErrorListener(ThrowingErrorListener.INSTANCE);
  const tokenStream = new CommonTokenStream(lexer);

  // Parsing (throwing on errors)
  const parser = new CashScriptParser(tokenStream);
  parser.removeErrorListeners();
  parser.addErrorListener(ThrowingErrorListener.INSTANCE);
  const parseTree = parser.sourceFile();

  // AST building
  const ast = new AstBuilder(parseTree).build() as Ast;

  return ast;
}

export function hexWithPlaceholders(asm: string): string {
  return asm
    .split(' ')
    .filter(Boolean)
    .map((part: string) => {
      if (part.startsWith('$')) {
        return `<${part.substring(1)}>`;
      }
      return binToHex(asmToBytecode(part));
    })
    .join('');
}

export function asmWithPlaceholders(asm: string): string {
  return asm.replace(/OP_UNKNOWN255 ([0-9a-z]+)/g, (_, name) => `$${binToUtf8(hexToBin(name))}`);
}
