/**
 * Feature: forgekit, Property 34: Tag compatibility helpers
 *
 * Validates: Requirements 46.2, 46.3, 46.5
 *
 * Phase 6.24 gate referenced Property 34 as the tag-compatibility
 * check wired into the `forgekit-rpg` release pipeline. The existing
 * `property_tag_core_min_version.test.ts` covers the pipeline as a
 * whole; this file adds the companion property for the two pure
 * helpers backing the pipeline's `tools/verify-manifest-tag.sh`
 * script:
 *
 *   1. `isValidCoreMinVersion(v)` returns `true` iff the input is a
 *      plain SemVer `MAJOR.MINOR.PATCH` triple of non-negative
 *      integers without leading zeros and without a `v` prefix. The
 *      `v` prefix is the git-tag convention; manifests carry plain
 *      SemVer.
 *
 *   2. `buildTagRefUrl({owner, repo, tag})` always produces a URL of
 *      the form `repos/<owner>/<repo>/git/refs/tags/v<tag>` — the `v`
 *      is re-added at URL-assembly time so the manifest SemVer
 *      resolves against the actual git-tag name.
 *
 * The helpers live in `mcp-server/src/verify_manifest_tag.ts`, a port
 * of the pure logic originally shipped in
 * `forgekit-rpg/tools/verify-manifest-tag.js` so that the ForgeKit
 * Core MCP Server can test them without a cross-repository import.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  buildTagRefUrl,
  isValidCoreMinVersion,
} from '../src/verify_manifest_tag.js';

/** Pinned iteration count per Phase 6.24 gate specification. */
const NUM_RUNS = 100 as const;

// ---------------------------------------------------------------------------
// Arbitrary: canonical SemVer `X.Y.Z` strings (no leading zeros, no `v`).
// ---------------------------------------------------------------------------

/**
 * Returns a stringified non-negative integer with no leading zeros —
 * that is, `0` itself or any digit sequence starting with `1..9`.
 */
const noLeadingZeroNum: fc.Arbitrary<string> = fc.oneof(
  fc.constant('0'),
  fc
    .tuple(
      fc.integer({ min: 1, max: 9 }).map((d) => String(d)),
      fc.string({ minLength: 0, maxLength: 3, unit: fc.constantFrom(
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
      ) }),
    )
    .map(([head, tail]) => head + tail),
);

const canonicalSemverArb: fc.Arbitrary<string> = fc
  .tuple(noLeadingZeroNum, noLeadingZeroNum, noLeadingZeroNum)
  .map(([a, b, c]) => `${a}.${b}.${c}`);

// ---------------------------------------------------------------------------
// Arbitrary: arbitrary strings (may or may not match the grammar).
// ---------------------------------------------------------------------------

const freeformStringArb: fc.Arbitrary<string> = fc.string({
  minLength: 0,
  maxLength: 20,
});

/**
 * Independent oracle — returns `true` iff `v` is exactly a plain
 * `MAJOR.MINOR.PATCH` triple of non-negative integers with no leading
 * zeros (except `0` itself), no `v` prefix, no pre-release / build
 * metadata, and no surrounding whitespace.
 */
function isCanonicalSemver(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const parts = v.split('.');
  if (parts.length !== 3) return false;
  for (const part of parts) {
    if (!/^(0|[1-9]\d*)$/.test(part)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Property 34a: isValidCoreMinVersion iff canonical SemVer
// ---------------------------------------------------------------------------

describe('Property 34: Tag compatibility — isValidCoreMinVersion iff canonical SemVer', () => {
  it('returns true for every canonical MAJOR.MINOR.PATCH and false otherwise', () => {
    fc.assert(
      fc.property(
        fc.oneof(canonicalSemverArb, freeformStringArb),
        (candidate) => {
          expect(isValidCoreMinVersion(candidate)).toBe(
            isCanonicalSemver(candidate),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('always accepts a canonical SemVer draw', () => {
    fc.assert(
      fc.property(canonicalSemverArb, (version) => {
        expect(isValidCoreMinVersion(version)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects any candidate with a leading `v` prefix', () => {
    fc.assert(
      fc.property(canonicalSemverArb, (version) => {
        expect(isValidCoreMinVersion(`v${version}`)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 34b: buildTagRefUrl shape
// ---------------------------------------------------------------------------

describe('Property 34: Tag compatibility — buildTagRefUrl shape', () => {
  it('always produces `repos/<owner>/<repo>/git/refs/tags/v<tag>`', () => {
    fc.assert(
      fc.property(canonicalSemverArb, (tag) => {
        const url = buildTagRefUrl({
          owner: 'ForgeKitStudio',
          repo: 'forgekit-core',
          tag,
        });
        expect(url).toBe(
          `repos/ForgeKitStudio/forgekit-core/git/refs/tags/v${tag}`,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('prepends exactly one `v` regardless of input capitalisation elsewhere', () => {
    fc.assert(
      fc.property(canonicalSemverArb, (tag) => {
        const url = buildTagRefUrl({
          owner: 'ForgeKitStudio',
          repo: 'forgekit-core',
          tag,
        });
        // Canonical form: exactly one `v` just before the SemVer
        // triple, never two, never zero.
        expect(url.endsWith(`/v${tag}`)).toBe(true);
        expect(url.includes('/vv')).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
