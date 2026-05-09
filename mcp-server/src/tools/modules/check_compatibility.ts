/**
 * Implementation of the `modules.check_compatibility` MCP tool.
 *
 * Compares `manifest.core_min_version` to the Core version sourced
 * from the Core repository's git tag at `projectRoot`. The git tag is
 * the single source of truth — no in-memory / runtime value is used
 * by default, because any such value can drift from the Core code on
 * disk (for example after a `git checkout` of a different tag).
 *
 * Callers MAY still pass `coreVersion` explicitly as a legacy shim
 * (unit tests, scripted tooling that already knows the version). When
 * supplied, it bypasses the git resolver entirely; otherwise the tool
 * invokes `resolveVersion(projectRoot)` which defaults to
 * `resolveCoreVersionFromGit`. The SemVer comparator is unchanged
 * across both paths so the contract stays identical.
 */

import { ToolInputError } from '../project/errors.js';
import { scanModules } from '../project/module_scan.js';
import { resolveCoreVersionFromGit } from './core_version.js';
import { ModuleNotFoundError } from './errors.js';

/** Minimal logger surface used to surface `CORE_VERSION_MISMATCH`. */
export interface CheckCompatibilityLogger {
  warn(message: string): void;
}

export interface CheckCompatibilityParams {
  projectRoot: string;
  moduleId: string;
  /**
   * Optional caller-supplied Core version. Exists only as a legacy
   * shim for unit tests and scripted tooling; when omitted the tool
   * resolves the version from the git tag at `projectRoot`.
   */
  coreVersion?: string;
  /**
   * Optional override of the git resolver. Defaults to
   * `resolveCoreVersionFromGit`. Ignored when `coreVersion` is set.
   */
  resolveVersion?: (projectRoot: string) => Promise<string>;
  /**
   * Optional logger receiving a `CORE_VERSION_MISMATCH` warning when
   * the installed Core version is older than `manifest.core_min_version`
   * or either side fails to parse as SemVer. The message carries the
   * module id, required version, and installed version so callers can
   * surface the mismatch without re-reading the manifest.
   */
  logger?: CheckCompatibilityLogger;
}

export interface CheckCompatibilityResult {
  compatible: boolean;
  core_version: string;
  core_min_version: string;
  /**
   * Alias for `core_min_version`. Surfaced under the shorter name so
   * callers following the requirements-document language (which calls
   * the fields `required` and `installed`) can read the same fact
   * without duplicating the comparator logic on the caller side.
   */
  required: string;
  /** Alias for `core_version`. See `required` for the rationale. */
  installed: string;
  module_id: string;
  reason?: string;
}

export async function checkCompatibility(
  params: CheckCompatibilityParams,
): Promise<CheckCompatibilityResult> {
  if (
    typeof params.projectRoot !== 'string' ||
    params.projectRoot.trim() === ''
  ) {
    throw new ToolInputError(
      `"projectRoot" must be a non-empty string (got ${JSON.stringify(params.projectRoot)}).`,
    );
  }
  if (typeof params.moduleId !== 'string' || params.moduleId.trim() === '') {
    throw new ToolInputError(
      `"moduleId" must be a non-empty string (got ${JSON.stringify(params.moduleId)}).`,
    );
  }

  // `coreVersion` is explicitly optional now: when provided it must
  // still be a non-empty string (that's a distinct error from omission
  // and matches the old legacy-shim contract). When absent we resolve
  // from git later.
  if (params.coreVersion !== undefined) {
    if (
      typeof params.coreVersion !== 'string' ||
      params.coreVersion.trim() === ''
    ) {
      throw new ToolInputError(
        `"coreVersion" must be a non-empty string (got ${JSON.stringify(params.coreVersion)}).`,
      );
    }
  }

  const discovered = await scanModules(params.projectRoot);
  const hit = discovered.find((m) => m.manifest.id === params.moduleId);
  if (!hit) {
    throw new ModuleNotFoundError(params.moduleId);
  }

  const coreMin = hit.manifest.core_min_version;
  const resolveVersion: (projectRoot: string) => Promise<string> =
    params.resolveVersion ??
    ((projectRoot) => resolveCoreVersionFromGit({ projectRoot }));
  const coreVersion =
    params.coreVersion !== undefined
      ? params.coreVersion
      : await resolveVersion(params.projectRoot);

  const minParsed = parseSemver(coreMin);
  const coreParsed = parseSemver(coreVersion);
  if (minParsed === null) {
    return finalize({
      compatible: false,
      core_version: coreVersion,
      core_min_version: coreMin,
      required: coreMin,
      installed: coreVersion,
      module_id: params.moduleId,
      reason: `core_min_version "${coreMin}" is malformed`,
    }, params.logger);
  }
  if (coreParsed === null) {
    return finalize({
      compatible: false,
      core_version: coreVersion,
      core_min_version: coreMin,
      required: coreMin,
      installed: coreVersion,
      module_id: params.moduleId,
      reason: `core_version "${coreVersion}" is malformed`,
    }, params.logger);
  }

  const compatible = compareSemver(coreParsed, minParsed) >= 0;
  const result: CheckCompatibilityResult = {
    compatible,
    core_version: coreVersion,
    core_min_version: coreMin,
    required: coreMin,
    installed: coreVersion,
    module_id: params.moduleId,
  };
  if (!compatible) {
    result.reason = `core_version ${coreVersion} < core_min_version ${coreMin}`;
  }
  return finalize(result, params.logger);
}

/**
 * Emits the `CORE_VERSION_MISMATCH` warning when the result is
 * incompatible, then returns the result unchanged. Kept local so
 * every code path that builds a result funnels through the same
 * logging contract.
 */
function finalize(
  result: CheckCompatibilityResult,
  logger: CheckCompatibilityLogger | undefined,
): CheckCompatibilityResult {
  if (!result.compatible && logger !== undefined) {
    logger.warn(
      `CORE_VERSION_MISMATCH: module "${result.module_id}" requires core_min_version ${result.core_min_version} but core_version ${result.core_version} is installed`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// SemVer comparator (kept local; pre-release / build metadata are
// stripped because ForgeKit manifests do not use them).
// ---------------------------------------------------------------------------

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(raw: string): Semver | null {
  let v = raw.trim();
  if (v.startsWith('v') || v.startsWith('V')) {
    v = v.slice(1);
  }
  const hyphen = v.indexOf('-');
  if (hyphen !== -1) v = v.slice(0, hyphen);
  const plus = v.indexOf('+');
  if (plus !== -1) v = v.slice(0, plus);

  const parts = v.split('.');
  if (parts.length !== 3) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    nums.push(Number.parseInt(part, 10));
  }
  return { major: nums[0], minor: nums[1], patch: nums[2] };
}

/** Returns -1/0/1 for `<`, `==`, `>`. */
function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}
