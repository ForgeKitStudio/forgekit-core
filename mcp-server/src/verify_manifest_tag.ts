/**
 * Pure helpers backing the `tools/verify-manifest-tag.sh` release-pipeline
 * gate shipped in the `ForgeKitStudio/forgekit-rpg` repository.
 *
 * The originals live in `forgekit-rpg/tools/verify-manifest-tag.js` and
 * are embedded in the shell script through `node --input-type=module`.
 * This module is a byte-for-byte TypeScript port of those helpers kept
 * inside the `@forgekitstudio/core-mcp` package so the ForgeKit Core MCP
 * Server can property-test the contract without importing across
 * repositories.
 *
 * Contract notes:
 *   * `core_min_version` in `module.manifest.tres` is a plain SemVer
 *     `MAJOR.MINOR.PATCH` string. This matches
 *     `ModuleManifest._parse_semver` in Core, which splits on `.` and
 *     requires exactly three non-negative integers without any prefix.
 *   * Git tags in the Core repository follow the `vX.Y.Z` convention
 *     (see `forgekit-core` v0.3.0 tag). `buildTagRefUrl` therefore
 *     prepends `v` when it assembles the GitHub `git/refs/tags/` path
 *     so the semantic manifest value resolves against the actual
 *     git-tag name.
 */

/**
 * Plain SemVer `MAJOR.MINOR.PATCH` pattern restricted to non-negative
 * integers without leading zeros. Matches the semantic value stored
 * in `core_min_version` — not the git-tag format, which carries a
 * leading `v` that is added by `buildTagRefUrl` at URL-assembly time.
 */
const CORE_MIN_VERSION_PATTERN: RegExp =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Extract the `core_min_version` field from the text of a Godot `.tres`
 * resource file. Returns `undefined` when the field is absent or not a
 * quoted string.
 *
 * The matcher is line-oriented and tolerates arbitrary whitespace
 * around the `=` separator. When the field appears multiple times the
 * first occurrence wins — the shell wrapper surfaces the result as a
 * single value so callers cannot accidentally use a shadowed field.
 */
export function extractCoreMinVersion(
  tresContent: string,
): string | undefined {
  const pattern =
    /^[\t ]*core_min_version[\t ]*=[\t ]*"([^"]*)"[\t ]*$/m;
  const match = pattern.exec(tresContent);
  if (match === null) {
    return undefined;
  }
  return match[1];
}

/**
 * Returns `true` when the given string is a plain SemVer
 * `MAJOR.MINOR.PATCH` triple of non-negative integers without leading
 * zeros. Values carrying a leading `v` (the git-tag convention) are
 * rejected — `buildTagRefUrl` is responsible for converting between
 * the two.
 *
 * Empty strings, whitespace-only input, non-numeric components and
 * triples shorter than three parts are rejected.
 */
export function isValidCoreMinVersion(candidate: unknown): boolean {
  if (typeof candidate !== 'string') {
    return false;
  }
  return CORE_MIN_VERSION_PATTERN.test(candidate);
}

/** Input bundle for {@link buildTagRefUrl}. */
export interface BuildTagRefUrlInput {
  readonly owner: string;
  readonly repo: string;
  readonly tag: string;
}

/**
 * Build the path segment passed to `gh api` to resolve a git tag ref.
 *
 * Accepts a plain SemVer `MAJOR.MINOR.PATCH` value (the format used
 * in `module.manifest.tres`) and prepends `v` to reconstruct the
 * git-tag name used in the Core repository (for example `0.3.0` →
 * `refs/tags/v0.3.0`).
 *
 * The caller is responsible for URL-safe values — the ForgeKit Core
 * repository coordinates (`ForgeKitStudio/forgekit-core`) and the
 * SemVer tag are known ASCII strings, so no percent-encoding is
 * applied.
 */
export function buildTagRefUrl(input: BuildTagRefUrlInput): string {
  const { owner, repo, tag } = input;
  return `repos/${owner}/${repo}/git/refs/tags/v${tag}`;
}

/** Shape of the `MANIFEST_TAG_NOT_FOUND` error payload. */
export interface ManifestTagNotFoundError {
  readonly error: {
    readonly code: -32011;
    readonly message: 'MANIFEST_TAG_NOT_FOUND';
    readonly data: { readonly tag: string };
  };
}

/**
 * Serialise a `MANIFEST_TAG_NOT_FOUND` JSON-RPC error payload.
 *
 * The exact shape is fixed and mirrored by the `release-module.yml`
 * workflow, so callers rely on the literal byte sequence — the field
 * ordering must stay stable across releases. The `tag` value is
 * embedded verbatim (plain SemVer, no prefix) so the operator can
 * trace back to the manifest field.
 */
export function formatManifestTagError(input: { tag: string }): string {
  const { tag } = input;
  const escaped = JSON.stringify(tag);
  return `{"error":{"code":-32011,"message":"MANIFEST_TAG_NOT_FOUND","data":{"tag":${escaped}}}}`;
}
