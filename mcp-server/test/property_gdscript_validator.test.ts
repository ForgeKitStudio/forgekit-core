/**
 * Feature: forgekit, Property 14: GDScript validator detects syntax errors with accurate location
 *
 * Property-based test for the GDScript validator surfaced through the MCP
 * server. The validator itself lives in
 * `addons/forgekit_core/mcp/gdscript_validator.gd` and is driven here via a
 * thin headless adapter (see `helpers/gdscript_validator_client.ts`) that
 * spawns Godot once per batch and returns one `{ok, line}` record per input.
 *
 * For every iteration the generator produces:
 *   1. A syntactically valid GDScript source `s` with at least one
 *      mutable position.
 *   2. A mutation location `(line_m, col_m)` inside `s`.
 *   3. A mutated source `m` obtained by injecting a guaranteed-parse-error
 *      token at `(line_m, col_m)`.
 *
 * The property then asserts:
 *   - `validate(s).ok === true`  — the pristine source still parses.
 *   - `validate(m).ok === false` — the mutation produced a parse error.
 *   - The reported error line is within `[line_m - 1, line_m + 1]`. The
 *     one-line tolerance accommodates cases where the parser can only
 *     detect the error at the start of the following statement (the
 *     classical lookahead situation), which is a legitimate behaviour of
 *     the Godot parser, not a defect.
 *
 * One Godot invocation per property sample would be prohibitively slow
 * (~400 ms cold start). The helper batches all `(s, m)` pairs generated
 * during one `numRuns` sweep into a single headless run, so the whole
 * property completes in a single Godot launch.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  validateGdscriptBatch,
  type ValidationResult,
} from './helpers/gdscript_validator_client.js';

/** Pinned iteration count for this property. */
const NUM_RUNS = 100 as const;

// --------------------------------------------------------------------------
// Generators — build a valid GDScript source with a known mutation target.
// --------------------------------------------------------------------------

/**
 * Describes a valid source together with a target position for mutation.
 * Carrying the target alongside the source keeps the generator
 * deterministic: it does not need to search the generated text for a
 * suitable injection site.
 */
interface ValidSourceWithTarget {
  readonly source: string;
  /** 1-indexed line where the mutation will be injected. */
  readonly lineM: number;
  /** 1-indexed column on that line. */
  readonly colM: number;
}

/**
 * GDScript reserved words. Identifiers drawn from the `[a-z][a-z0-9_]*`
 * shape could accidentally land on one of these and turn a generated
 * source into a parse error before any mutation is applied, which would
 * poison the property. Filtering keeps the generator honest.
 */
const GDSCRIPT_KEYWORDS: ReadonlySet<string> = new Set([
  'and',
  'as',
  'assert',
  'await',
  'break',
  'breakpoint',
  'class',
  'class_name',
  'const',
  'continue',
  'elif',
  'else',
  'enum',
  'extends',
  'for',
  'func',
  'if',
  'in',
  'is',
  'match',
  'not',
  'null',
  'or',
  'pass',
  'preload',
  'return',
  'self',
  'signal',
  'static',
  'super',
  'true',
  'false',
  'var',
  'void',
  'when',
  'while',
  'yield',
]);

/** Valid identifier fragments used to build realistic bodies. */
const identifierArb = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,6}$/)
  .filter((s) => s.length > 0 && !GDSCRIPT_KEYWORDS.has(s));

/**
 * One of the four valid statement templates. The generator picks a
 * template and fills it with a guaranteed-unique local variable name
 * `v_<idx>` when the body is assembled, so bodies never contain two
 * declarations of the same name — which GDScript rejects as a parse
 * error and would poison the pristine-source assertion.
 */
type StatementTemplate =
  | { readonly kind: 'intAnnot'; readonly value: number }
  | { readonly kind: 'intInfer'; readonly value: number }
  | { readonly kind: 'strInfer'; readonly text: string }
  | { readonly kind: 'tmpInfer'; readonly value: number };

const statementTemplateArb: fc.Arbitrary<StatementTemplate> = fc.oneof(
  fc
    .integer({ min: -999, max: 999 })
    .map((value) => ({ kind: 'intAnnot', value }) as const),
  fc
    .integer({ min: -999, max: 999 })
    .map((value) => ({ kind: 'intInfer', value }) as const),
  identifierArb.map((text) => ({ kind: 'strInfer', text }) as const),
  fc
    .integer({ min: -999, max: 999 })
    .map((value) => ({ kind: 'tmpInfer', value }) as const),
);

function renderStatement(tmpl: StatementTemplate, varName: string): string {
  switch (tmpl.kind) {
    case 'intAnnot':
      return `\tvar ${varName}: int = ${tmpl.value}`;
    case 'intInfer':
      return `\tvar ${varName} := ${tmpl.value}`;
    case 'strInfer':
      return `\tvar ${varName} := "${tmpl.text}"`;
    case 'tmpInfer':
      return `\tvar ${varName} := ${tmpl.value}`;
  }
}

/**
 * Build a valid single-function GDScript source and pick a mutation target
 * on one of its statement lines. The column is chosen to land on a safe
 * insertion point so the mutated result is guaranteed to be syntactically
 * invalid.
 */
const validSourceArb: fc.Arbitrary<ValidSourceWithTarget> = fc
  .tuple(
    identifierArb, // function name
    fc.array(statementTemplateArb, { minLength: 1, maxLength: 5 }),
    fc.integer({ min: 0, max: 1_000_000 }), // raw target index, reduced mod body length
  )
  .map(([funcName, templates, rawTargetIdx]) => {
    const body: string[] = templates.map((tmpl, idx) =>
      renderStatement(tmpl, `v_${idx}`),
    );
    // Layout:
    //   line 1: extends RefCounted
    //   line 2: <blank>
    //   line 3: func <funcName>() -> int:
    //   line 4..3+body.length: body statements
    //   line 4+body.length: <blank>
    //   line 5+body.length: return 0  (kept so the function ends cleanly)
    const header = ['extends RefCounted', '', `func ${funcName}() -> int:`];
    const footer = ['', '\treturn 0', ''];
    const lines = [...header, ...body, ...footer];
    const source = lines.join('\n');

    // Pick a mutation target on a body line. The tab prefix means every
    // body line starts at column 1 with "\t" and is followed by "var ".
    // Injecting at column 6 places the bad token after "\tvar " and before
    // the identifier — a spot where GDScript always sees a parse error.
    const bodyIdx = rawTargetIdx % body.length;
    const lineM = header.length + 1 + bodyIdx; // 1-indexed
    const colM = 6;
    return { source, lineM, colM } as ValidSourceWithTarget;
  });

/**
 * Inject a guaranteed-illegal token at `(line, col)` inside `source`.
 * The token is a sequence of unmatched brackets and operators that cannot
 * appear in the middle of a statement in any valid GDScript program.
 */
function injectMutation(source: string, line: number, col: number): string {
  const lines = source.split('\n');
  // Guard against off-by-one mistakes in the generator — the property test
  // would be useless if it silently mutated the wrong line.
  if (line < 1 || line > lines.length) {
    throw new Error(`mutation line ${line} out of range for ${lines.length}`);
  }
  const target = lines[line - 1];
  const safeCol = Math.min(Math.max(col, 1), target.length + 1);
  const before = target.slice(0, safeCol - 1);
  const after = target.slice(safeCol - 1);
  const badToken = '@@@)))'; // illegal sequence in any GDScript context
  lines[line - 1] = `${before}${badToken}${after}`;
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// Property — one Godot run drives the whole batch.
// --------------------------------------------------------------------------

interface BatchCase {
  readonly pristine: string;
  readonly mutated: string;
  readonly lineM: number;
  readonly colM: number;
}

describe('Property 14: GDScript validator detects syntax errors with accurate location', () => {
  it('returns ok=true for the pristine source and a line in [lineM-1, lineM+1] for the mutated source', async () => {
    // Collect every (pristine, mutated) pair produced during the fast-check
    // sweep into a single array so the whole batch travels to Godot in one
    // spawn.
    const cases: BatchCase[] = [];
    await fc.assert(
      fc.property(validSourceArb, ({ source, lineM, colM }) => {
        const mutated = injectMutation(source, lineM, colM);
        cases.push({ pristine: source, mutated, lineM, colM });
        return true;
      }),
      { numRuns: NUM_RUNS },
    );

    expect(cases).toHaveLength(NUM_RUNS);

    // Flatten: the batch driver validates sources in order, so pristine
    // and mutated alternate pair by pair.
    const inputs: string[] = [];
    for (const c of cases) {
      inputs.push(c.pristine, c.mutated);
    }
    const results: ValidationResult[] = await validateGdscriptBatch(inputs);
    expect(results).toHaveLength(inputs.length);

    // Assert the property for each generated case.
    for (let i = 0; i < cases.length; i++) {
      const { pristine, mutated, lineM } = cases[i];
      const pristineResult = results[2 * i];
      const mutatedResult = results[2 * i + 1];

      expect(pristineResult.ok, `pristine source must parse:\n${pristine}`).toBe(
        true,
      );
      expect(mutatedResult.ok, `mutated source must not parse:\n${mutated}`).toBe(
        false,
      );
      expect(
        mutatedResult.line,
        `reported line for mutated source must be defined:\n${mutated}`,
      ).toBeDefined();

      const reported = mutatedResult.line as number;
      expect(
        reported,
        `reported line ${reported} must be within [${lineM - 1}, ${
          lineM + 1
        }] for mutation at line ${lineM}:\n${mutated}`,
      ).toBeGreaterThanOrEqual(lineM - 1);
      expect(reported).toBeLessThanOrEqual(lineM + 1);
    }
  }, 120_000);
});
