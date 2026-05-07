/**
 * Unit and property tests for the release-tag validator used by the
 * `release.yml` and `npm-publish.yml` GitHub Actions workflows.
 *
 * The validator is a pure function that compares a git tag (e.g. `v1.2.3`)
 * against the version declared in `mcp-server/package.json` and rejects
 * malformed tags or mismatched versions. Both workflows share a `validate-tag`
 * job that fails fast when either check fails.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { validateReleaseTag } from '../scripts/ci/validate_release_tag.js';

describe('validateReleaseTag — accepted tag/version pairs', () => {
  it('accepts a plain major.minor.patch tag matching package.json', () => {
    const result = validateReleaseTag({ tag: 'v0.1.0', packageJsonVersion: '0.1.0' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe('0.1.0');
    }
  });

  it('accepts a non-zero major.minor.patch tag matching package.json', () => {
    const result = validateReleaseTag({ tag: 'v1.2.3', packageJsonVersion: '1.2.3' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe('1.2.3');
    }
  });

  it('accepts a SemVer prerelease tag matching package.json', () => {
    const result = validateReleaseTag({
      tag: 'v1.0.0-beta.1',
      packageJsonVersion: '1.0.0-beta.1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe('1.0.0-beta.1');
    }
  });
});

describe('validateReleaseTag — malformed tags', () => {
  it('rejects a tag without the leading v', () => {
    const result = validateReleaseTag({ tag: '1.0.0', packageJsonVersion: '1.0.0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_TAG_FORMAT');
    }
  });

  it('rejects a tag missing the patch component', () => {
    const result = validateReleaseTag({ tag: 'v1.0', packageJsonVersion: '1.0.0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_TAG_FORMAT');
    }
  });

  it('rejects a tag with non-numeric components', () => {
    const result = validateReleaseTag({ tag: 'vabc', packageJsonVersion: '0.0.0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_TAG_FORMAT');
    }
  });
});

describe('validateReleaseTag — mismatched version', () => {
  it('rejects when the tag version differs from package.json', () => {
    const result = validateReleaseTag({ tag: 'v1.0.0', packageJsonVersion: '0.9.9' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VERSION_MISMATCH');
      expect(result.expected).toBe('1.0.0');
      expect(result.actual).toBe('0.9.9');
    }
  });
});

describe('Property: validator accepts iff tag version equals package.json version', () => {
  const NUM_RUNS = 100 as const;
  const componentArb = fc.integer({ min: 0, max: 999 });
  const versionTripleArb = fc.tuple(componentArb, componentArb, componentArb);

  it('accepts any matching (tag, packageJsonVersion) pair and rejects any differing pair', () => {
    fc.assert(
      fc.property(versionTripleArb, versionTripleArb, (tagTriple, pkgTriple) => {
        const [tagMajor, tagMinor, tagPatch] = tagTriple;
        const [pkgMajor, pkgMinor, pkgPatch] = pkgTriple;
        const tagVersion = `${tagMajor}.${tagMinor}.${tagPatch}`;
        const pkgVersion = `${pkgMajor}.${pkgMinor}.${pkgPatch}`;
        const tag = `v${tagVersion}`;

        const result = validateReleaseTag({ tag, packageJsonVersion: pkgVersion });

        if (tagVersion === pkgVersion) {
          return result.ok === true && result.version === tagVersion;
        }
        if (!result.ok) {
          return (
            result.code === 'VERSION_MISMATCH' &&
            result.expected === tagVersion &&
            result.actual === pkgVersion
          );
        }
        return false;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
