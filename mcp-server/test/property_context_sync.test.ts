/**
 * Feature: forgekit, Property 33: Context-file synchronization
 *
 * Validates: Requirements 41.4, 41.5
 *
 * Property-based sibling of `pre_commit_context.test.ts` — for any
 * generated bundle `(staged_files, context_map)`, the set of required
 * anchors returned by `findRequiredAnchors` must be exactly the union
 * of anchors declared by every mapping whose pattern matches at least
 * one staged file. Anchors for non-matching mappings MUST NOT appear,
 * and anchors for matching mappings MUST appear for every matched
 * code file. This mirrors the iff contract documented in the
 * pre-commit hook and enforced by CI.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ERROR_CODE_CONTEXT_FILE_STALE,
  ERROR_MESSAGE_CONTEXT_FILE_STALE,
  findRequiredAnchors,
  matchesGlob,
  type ContextMap,
  type StaleAnchor,
} from '../scripts/git-hooks/pre-commit.js';

const NUM_RUNS = 100 as const;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A repo-relative file path with two or three segments of safe chars. */
const pathSegment = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
const stagedFileArb = fc
  .tuple(
    pathSegment,
    pathSegment,
    fc.oneof(pathSegment, fc.constant('game_events.gd'), fc.constant('foo.ts')),
  )
  .map(([a, b, c]) => `${a}/${b}/${c}`);

const anchorArb = fc
  .tuple(fc.constantFrom('CLAUDE.md', '.cursorrules'), pathSegment)
  .map(([file, slug]) => `${file}#${slug}`);

/**
 * Pattern grammar (subset used by the live context map): either a
 * literal path, a `**` recursive glob, or a `*` single-segment glob.
 */
const patternArb = fc.oneof(
  stagedFileArb,
  fc.tuple(pathSegment, pathSegment).map(([a, b]) => `${a}/${b}/**/*.gd`),
  fc.tuple(pathSegment).map(([a]) => `${a}/**/*.ts`),
  fc.tuple(pathSegment, pathSegment).map(([a, b]) => `${a}/${b}/*.gd`),
);

const mappingArb = fc.record({
  pattern: patternArb,
  anchors: fc.array(anchorArb, { minLength: 1, maxLength: 3 }),
});

const contextMapArb = fc.record({
  version: fc.constant(1 as const),
  mappings: fc.array(mappingArb, { minLength: 0, maxLength: 5 }),
}) as fc.Arbitrary<ContextMap>;

const stagedFilesArb = fc.array(stagedFileArb, { minLength: 0, maxLength: 6 });

// ---------------------------------------------------------------------------
// Independent oracle
// ---------------------------------------------------------------------------

/**
 * Compute the expected `StaleAnchor[]` by brute-force matching every
 * (file, mapping) pair. Order matches the iteration order of the
 * implementation so the property can compare arrays directly.
 */
function expectedAnchors(
  stagedFiles: readonly string[],
  contextMap: ContextMap,
): StaleAnchor[] {
  const out: StaleAnchor[] = [];
  for (const file of stagedFiles) {
    for (const mapping of contextMap.mappings) {
      if (!matchesGlob(file, mapping.pattern)) continue;
      for (const anchor of mapping.anchors) {
        out.push({ code_file: file, required_anchor: anchor });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 33: Context-file synchronization', () => {
  it('findRequiredAnchors matches the brute-force oracle', () => {
    fc.assert(
      fc.property(stagedFilesArb, contextMapArb, (files, map) => {
        const got = findRequiredAnchors(files, map);
        const want = expectedAnchors(files, map);
        expect(got).toEqual(want);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns the empty list for an empty mapping set', () => {
    fc.assert(
      fc.property(stagedFilesArb, (files) => {
        const result = findRequiredAnchors(files, {
          version: 1,
          mappings: [],
        });
        expect(result).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('anchors for non-matching patterns never appear', () => {
    fc.assert(
      fc.property(stagedFilesArb, contextMapArb, (files, map) => {
        const result = findRequiredAnchors(files, map);
        for (const entry of result) {
          // Every surfaced anchor must belong to a mapping whose
          // pattern matches at least one staged file.
          const hasMatch = map.mappings.some(
            (m) =>
              m.anchors.includes(entry.required_anchor) &&
              files.some((f) => matchesGlob(f, m.pattern)),
          );
          expect(hasMatch).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('ERROR_CODE_CONTEXT_FILE_STALE is the stable -32012 payload', () => {
    expect(ERROR_CODE_CONTEXT_FILE_STALE).toBe(-32012);
    expect(ERROR_MESSAGE_CONTEXT_FILE_STALE).toBe('CONTEXT_FILE_STALE');
  });
});
