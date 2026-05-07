/**
 * Feature: forgekit, Property 15: .gd write is rejected iff validator returns an error
 *
 * Property-based test for `gdscript.save_with_validation`. The tool is a
 * composition of two primitives defined in ForgeKit Core:
 *
 *   • `GDScriptValidator.validate(source)` parses the source without
 *     touching the filesystem and returns `{ok, errors, duration_ms}`.
 *   • `McpScriptWriter.write(path, source)` writes `source` to `path`
 *     atomically, but only after the validator reports `ok == true`.
 *
 * The property asserts a strict if-and-only-if relationship between the
 * two: for every random `(source, path, pre_existing)` triple, the write
 * succeeds exactly when validation succeeds, and on failure the target
 * file is left byte-identical to what was there before the call (or
 * absent if there was no seed). This is the TypeScript analogue of the
 * GDScript-side unit tests in `tests/unit/test_script_writer.gd` and
 * complements them by sweeping 100 random inputs through a single
 * headless Godot run.
 *
 * We write every case under `user://forgekit_pbt_save_iff_valid/` so the
 * property never collides with real project files and the
 * `Core_Boundary` never fires for reasons unrelated to the property.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  runSaveWithValidationBatch,
  type SaveCase,
  type SaveResult,
} from './helpers/save_with_validation_client.js';

/** Pinned iteration count for this property. */
const NUM_RUNS = 100 as const;

/**
 * GDScript JSON-RPC error code for a parse failure. Mirrors
 * `McpErrorCodes.GDSCRIPT_SYNTAX_ERROR` in
 * `addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd`.
 */
const GDSCRIPT_SYNTAX_ERROR_CODE = -32003 as const;

/**
 * Root under which every generated case lives. Picked so the property
 * never writes into the project tree or triggers the Core_Boundary
 * check, isolating the iff relationship being tested.
 */
const SANDBOX_ROOT = 'user://forgekit_pbt_save_iff_valid';

// --------------------------------------------------------------------------
// Generators
// --------------------------------------------------------------------------

/** A valid, minimal GDScript source that always parses cleanly. */
function makeValidSource(funcName: string, value: number): string {
  return [
    'extends RefCounted',
    '',
    `func ${funcName}() -> int:`,
    `\treturn ${value}`,
    '',
  ].join('\n');
}

/**
 * A syntactically invalid GDScript source. The unmatched `(` plus the
 * dangling newline is rejected by the Godot parser in every release
 * line we support.
 */
function makeInvalidSource(funcName: string): string {
  return [
    'extends RefCounted',
    '',
    `func ${funcName}(`,
    '\treturn 0',
    '',
  ].join('\n');
}

/** Identifiers used for function names. */
const identifierArb = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,6}$/)
  .filter((s) => s.length > 0);

const validSourceArb: fc.Arbitrary<string> = fc
  .tuple(identifierArb, fc.integer({ min: -999, max: 999 }))
  .map(([name, value]) => makeValidSource(name, value));

const invalidSourceArb: fc.Arbitrary<string> = identifierArb.map((name) =>
  makeInvalidSource(name),
);

/**
 * Random source that is valid or invalid with equal probability. Mixing
 * both kinds in a single sweep is what lets the iff direction be
 * observed: a generator that only produced valid samples could be
 * satisfied by a writer that ignored validation entirely.
 */
const sourceArb: fc.Arbitrary<string> = fc.oneof(
  validSourceArb,
  invalidSourceArb,
);

/**
 * Random target path under the sandbox. The basename embeds the case
 * index so file operations from different cases never collide even if
 * Godot reuses `user://` between invocations.
 */
function caseArb(caseIndex: number): fc.Arbitrary<SaveCase> {
  const pathArb = identifierArb.map(
    (slug) => `${SANDBOX_ROOT}/case_${caseIndex}_${slug}.gd`,
  );
  // A mix of "no pre-existing file" and "some random text already
  // there" so the invariant "file unchanged on error" is exercised in
  // both shapes.
  const preExistingArb: fc.Arbitrary<string | null> = fc.oneof(
    fc.constant(null),
    fc
      .string({ minLength: 0, maxLength: 40 })
      // Avoid producing a string that could be mistaken for a valid
      // GDScript source by the reader. The content is opaque to the
      // writer; any bytes are fine as long as they round-trip.
      .map((s) => `# baseline ${s}\n`),
  );
  return fc
    .tuple(pathArb, sourceArb, preExistingArb)
    .map(
      ([path, source, preExisting]) =>
        ({ path, source, preExisting }) satisfies SaveCase,
    );
}

// --------------------------------------------------------------------------
// Property
// --------------------------------------------------------------------------

describe('Property 15: .gd write is rejected iff validator returns an error', () => {
  it(
    'save_with_validation succeeds iff validate(src).ok; file is unchanged on error',
    async () => {
      // Collect every case produced during the fast-check sweep into a
      // single array so the whole batch travels to Godot in one spawn.
      const cases: SaveCase[] = [];
      await fc.assert(
        fc.property(
          fc.integer({ min: 0, max: NUM_RUNS - 1 }).chain((i) => caseArb(i)),
          (sample) => {
            cases.push(sample);
            return true;
          },
        ),
        { numRuns: NUM_RUNS },
      );
      expect(cases).toHaveLength(NUM_RUNS);

      const results: SaveResult[] = await runSaveWithValidationBatch(cases);
      expect(results).toHaveLength(cases.length);

      for (let i = 0; i < cases.length; i++) {
        const { source, preExisting } = cases[i];
        const r = results[i];

        // Iff direction: written is exactly validate_ok.
        expect(
          r.written,
          `written must equal validate_ok for source:\n${source}`,
        ).toBe(r.validateOk);

        if (r.validateOk) {
          // On success the file exists and contains the supplied source.
          expect(
            r.existsAfter,
            `file must exist after a successful write:\n${source}`,
          ).toBe(true);
          expect(
            r.contentAfter,
            `file contents must match the supplied source:\n${source}`,
          ).toBe(source);
          expect(
            r.errorCode,
            `successful write must not carry an error envelope`,
          ).toBeUndefined();
        } else {
          // On failure the writer must signal GDSCRIPT_SYNTAX_ERROR...
          expect(
            r.errorCode,
            `failed write must carry GDSCRIPT_SYNTAX_ERROR:\n${source}`,
          ).toBe(GDSCRIPT_SYNTAX_ERROR_CODE);
          // ...and the on-disk state must match the pre-existing state
          // byte-for-byte: either the file stays absent (no seed) or it
          // retains the seeded bytes (seed present).
          if (preExisting === null) {
            expect(
              r.existsAfter,
              `file must not be created when validation fails:\n${source}`,
            ).toBe(false);
          } else {
            expect(
              r.existsAfter,
              `seeded file must still exist after a rejected write:\n${source}`,
            ).toBe(true);
            expect(
              r.contentAfter,
              `seeded file contents must be unchanged after a rejected write:\n${source}`,
            ).toBe(preExisting);
          }
        }
      }
    },
    180_000,
  );
});
