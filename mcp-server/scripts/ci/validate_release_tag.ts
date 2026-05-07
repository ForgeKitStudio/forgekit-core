/**
 * Release-tag validator shared by the `release.yml` and `npm-publish.yml`
 * GitHub Actions workflows.
 *
 * Verifies two independent invariants:
 *
 *   1. The git tag that triggered the workflow matches SemVer 2.0 with the
 *      mandatory `v` prefix (e.g. `v1.2.3`, `v1.0.0-beta.1`, `v2.0.0+build.7`).
 *   2. The SemVer payload extracted from the tag (tag minus the leading `v`)
 *      equals the `version` field declared in `mcp-server/package.json`.
 *
 * On success the validator returns the extracted version so the downstream
 * `release` / `publish-npm` jobs can reuse it as a workflow output. On
 * failure it returns a discriminated error with a stable machine-readable
 * `code` so CI logs are easy to diff.
 */

/**
 * SemVer 2.0 tag pattern with the `v` prefix, honouring the optional
 * `-<prerelease>` and `+<build>` components from the specification at
 * https://semver.org/#backusnaur-form-grammar-for-valid-semver-versions
 *
 * Deliberately anchored at both ends so trailing whitespace or accidental
 * refs/tags/ prefixes are rejected.
 */
const TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export type ValidateReleaseTagSuccess = {
  readonly ok: true;
  readonly version: string;
};

export type ValidateReleaseTagFailureCode =
  | 'INVALID_TAG_FORMAT'
  | 'VERSION_MISMATCH';

export type ValidateReleaseTagFailure = {
  readonly ok: false;
  readonly code: ValidateReleaseTagFailureCode;
  readonly message: string;
  readonly expected: string;
  readonly actual: string;
};

export type ValidateReleaseTagResult =
  | ValidateReleaseTagSuccess
  | ValidateReleaseTagFailure;

export interface ValidateReleaseTagInput {
  /** Git tag as it appears in `github.ref_name`, e.g. `v1.2.3`. */
  readonly tag: string;
  /** Value of the `version` field in `mcp-server/package.json`. */
  readonly packageJsonVersion: string;
}

/**
 * Validate a git tag against the package.json version. Pure function: it
 * never reads the filesystem, never prints anything, and never exits the
 * process. Those concerns belong to the CLI wrapper.
 */
export function validateReleaseTag(
  input: ValidateReleaseTagInput,
): ValidateReleaseTagResult {
  const { tag, packageJsonVersion } = input;

  if (!TAG_PATTERN.test(tag)) {
    return {
      ok: false,
      code: 'INVALID_TAG_FORMAT',
      message:
        'tag must follow SemVer 2.0 with the leading "v" (example: v1.2.3 or v1.0.0-beta.1)',
      expected: 'v<MAJOR>.<MINOR>.<PATCH>[-<prerelease>][+<build>]',
      actual: tag,
    };
  }

  const tagVersion = tag.slice(1);
  if (tagVersion !== packageJsonVersion) {
    return {
      ok: false,
      code: 'VERSION_MISMATCH',
      message:
        'tag version does not match mcp-server/package.json — bump package.json or move the tag',
      expected: tagVersion,
      actual: packageJsonVersion,
    };
  }

  return { ok: true, version: tagVersion };
}
