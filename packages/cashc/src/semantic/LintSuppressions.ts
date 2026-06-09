import { LintWarning } from '@radiantscript/utils';
import { LINT_RULE_NAMES, LintRule } from './CovenantLintTraversal.js';

// ---------------------------------------------------------------------------
// Comment-directive suppression for covenant-lint warnings.
//
// Comments are stripped before the AST is built, so suppression directives are
// recovered by scanning the RAW SOURCE. Three forms are supported (each may
// optionally name a single rule; when a rule is named only that rule is
// suppressed, otherwise all rules on the line are suppressed):
//
//   // covenant-lint-disable                 -> disable the whole file
//   // covenant-lint-disable-line [rule]     -> disable warnings on THIS line
//   // covenant-lint-disable-next-line [rule] -> disable warnings on the NEXT line
//
// A directive that names a rule which is not in the canonical set (a typo, e.g.
// `uncontrained-outputs`) used to silently no-op — the author thought they had
// suppressed a warning but had not. We now emit a meta-warning so the typo is
// visible. The canonical rule set lives in CovenantLintTraversal (LINT_RULE_NAMES)
// so the two can never drift apart.
// ---------------------------------------------------------------------------

// Meta-rule name for the "you named a rule that does not exist" diagnostic.
export const UNKNOWN_RULE_DIRECTIVE = 'unknown-lint-rule';

interface SuppressionDirective {
  // line the suppression applies to (1-based; for -next-line, already +1).
  targetLine: number;
  // line the DIRECTIVE itself sits on (where a meta-warning should point).
  directiveLine: number;
  // the named rule, or undefined for a wildcard (all rules).
  rule?: string;
}

interface Suppressions {
  // true when the whole file is disabled (then `rules` is irrelevant).
  wholeFile: boolean;
  // line number (1-based) -> set of suppressed rules. The wildcard '*' means
  // "all rules on this line".
  byLine: Map<number, Set<string>>;
  // every parsed directive, retained so unknown rule names can be diagnosed.
  directives: SuppressionDirective[];
}

const DISABLE_FILE = /\/\/\s*covenant-lint-disable(?![-\w])/;
const DISABLE_LINE = /\/\/\s*covenant-lint-disable-line(?:\s+([\w-]+))?/;
const DISABLE_NEXT_LINE = /\/\/\s*covenant-lint-disable-next-line(?:\s+([\w-]+))?/;

export function parseSuppressions(code: string): Suppressions {
  const lines = code.split('\n');
  const suppressions: Suppressions = { wholeFile: false, byLine: new Map(), directives: [] };

  lines.forEach((line, index) => {
    const lineNumber = index + 1; // 1-based to match AST locations

    // Order matters: the more specific `-next-line` / `-line` variants must be
    // tested before the bare `-disable`, which would otherwise swallow them.
    const nextLineMatch = line.match(DISABLE_NEXT_LINE);
    if (nextLineMatch) {
      addRule(suppressions, lineNumber + 1, lineNumber, nextLineMatch[1]);
      return;
    }

    const lineMatch = line.match(DISABLE_LINE);
    if (lineMatch) {
      addRule(suppressions, lineNumber, lineNumber, lineMatch[1]);
      return;
    }

    if (DISABLE_FILE.test(line)) {
      suppressions.wholeFile = true;
    }
  });

  return suppressions;
}

function addRule(
  suppressions: Suppressions,
  targetLine: number,
  directiveLine: number,
  rule?: string,
): void {
  const set = suppressions.byLine.get(targetLine) ?? new Set<string>();
  set.add(rule ?? '*');
  suppressions.byLine.set(targetLine, set);
  suppressions.directives.push({ targetLine, directiveLine, rule });
}

export function applySuppressions(warnings: LintWarning[], code: string): LintWarning[] {
  const suppressions = parseSuppressions(code);

  // Diagnose directives that name a rule which does not exist (a typo silently
  // no-ops the suppression otherwise). These meta-warnings are themselves NOT
  // suppressible by a (mistyped) directive, so the author always sees the typo.
  const metaWarnings: LintWarning[] = [];
  suppressions.directives.forEach((directive) => {
    if (directive.rule !== undefined && !LINT_RULE_NAMES.has(directive.rule)) {
      metaWarnings.push({
        rule: UNKNOWN_RULE_DIRECTIVE,
        message: `unknown covenant-lint rule '${directive.rule}' in suppression directive `
          + '— this directive suppresses nothing (check for a typo). Valid rules: '
          + `${[...LINT_RULE_NAMES].sort().join(', ')}.`,
        line: directive.directiveLine,
        column: 0,
      });
    }
  });

  if (suppressions.wholeFile) return metaWarnings;

  const kept = warnings.filter((warning) => {
    const suppressed = suppressions.byLine.get(warning.line);
    if (!suppressed) return true;
    // '*' suppresses everything on the line; otherwise only the named rule.
    return !(suppressed.has('*') || suppressed.has(warning.rule));
  });

  return [...kept, ...metaWarnings];
}

// Re-export so callers that only import LintSuppressions can still reach the
// canonical rule list / rule ids without a second import.
export { LINT_RULE_NAMES, LintRule };
