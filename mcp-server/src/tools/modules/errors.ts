/**
 * Shared errors and state-file helpers for the `modules.*` tool family.
 *
 * The dispatcher maps `ModuleNotFoundError` to the JSON-RPC error code
 * defined here, and forwards the verification-failed payload verbatim
 * for `modules.activate_license`.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** JSON-RPC error code for a missing module id. */
export const MODULE_NOT_FOUND_CODE = -32005 as const;

/** JSON-RPC error message string for a missing module id. */
export const MODULE_NOT_FOUND_MESSAGE = 'MODULE_NOT_FOUND' as const;

/** JSON-RPC error code for license verification failure. */
export const LICENSE_VERIFICATION_FAILED_CODE = -32006 as const;

/** JSON-RPC error message string for license verification failure. */
export const LICENSE_VERIFICATION_FAILED_MESSAGE =
  'license_verification_failed' as const;

/** JSON-RPC error code for any non-canonical license activation failure. */
export const ACTIVATION_FAILED_CODE = -32007 as const;

/** JSON-RPC error message string for a non-canonical activation failure. */
export const ACTIVATION_FAILED_MESSAGE = 'ACTIVATION_FAILED' as const;

/** JSON-RPC error code for failing to resolve the Core git tag. */
export const CORE_VERSION_UNAVAILABLE_CODE = -32008 as const;

/** JSON-RPC error message string for a missing Core git tag. */
export const CORE_VERSION_UNAVAILABLE_MESSAGE =
  'CORE_VERSION_UNAVAILABLE' as const;

/**
 * Raised by `modules.inspect_manifest`, `modules.enable`,
 * `modules.disable`, and `modules.check_compatibility` when the
 * requested module id is not present under `<projectRoot>/addons/`.
 */
export class ModuleNotFoundError extends Error {
  readonly code = MODULE_NOT_FOUND_CODE;
  readonly moduleMessage = MODULE_NOT_FOUND_MESSAGE;
  readonly moduleId: string;

  constructor(moduleId: string) {
    super(`${MODULE_NOT_FOUND_MESSAGE}: ${moduleId}`);
    this.name = 'ModuleNotFoundError';
    this.moduleId = moduleId;
  }
}

/**
 * Raised by `modules.activate_license` when the injected activator
 * reports `{activated: false, error: "license_verification_failed"}`.
 * Constructed as a plain error so `throw` works, while also exposing
 * the JSON-RPC `code`/`message`/`data` fields the dispatcher forwards.
 */
export class LicenseVerificationFailedError extends Error {
  readonly code = LICENSE_VERIFICATION_FAILED_CODE;
  readonly data: { module_id: string };

  constructor(moduleId: string) {
    super(LICENSE_VERIFICATION_FAILED_MESSAGE);
    this.name = 'LicenseVerificationFailedError';
    this.data = { module_id: moduleId };
  }
}

/**
 * Raised by `modules.activate_license` when the injected activator
 * reports `{activated: false}` with an `error` string that is *not*
 * the canonical `"license_verification_failed"` token. The original
 * error string is forwarded verbatim in `data.original_error` so
 * operators can diagnose unexpected failure modes (e.g. HMAC context
 * start errors, file-I/O faults) without rebundling them under the
 * verification-failed code.
 */
export class UnknownActivationError extends Error {
  readonly code = ACTIVATION_FAILED_CODE;
  readonly data: { module_id: string; original_error: string };

  constructor(moduleId: string, originalError: string) {
    super(ACTIVATION_FAILED_MESSAGE);
    this.name = 'UnknownActivationError';
    this.data = { module_id: moduleId, original_error: originalError };
  }
}

/**
 * Raised by `modules.check_compatibility` when the Core version cannot
 * be resolved from the Core repository's git tag at `projectRoot`. The
 * `reason` narrows the failure mode so the dispatcher and the caller
 * can distinguish between an empty `git describe` output and a non-
 * zero exit (e.g. "not a git repository", "No names found"). When git
 * emitted anything on stderr it is copied to `data.git_stderr`
 * verbatim so operators can diagnose host-specific breakage.
 */
export class CoreVersionUnavailableError extends Error {
  readonly code = CORE_VERSION_UNAVAILABLE_CODE;
  readonly data: {
    reason: 'git_describe_failed' | 'git_describe_empty';
    git_stderr?: string;
  };

  constructor(
    reason: 'git_describe_failed' | 'git_describe_empty',
    gitStderr?: string,
  ) {
    super(CORE_VERSION_UNAVAILABLE_MESSAGE);
    this.name = 'CoreVersionUnavailableError';
    this.data = gitStderr === undefined ? { reason } : { reason, git_stderr: gitStderr };
  }
}

// ---------------------------------------------------------------------------
// State-file helpers
// ---------------------------------------------------------------------------

/**
 * Shape of `<projectRoot>/.forgekit/modules_state.json`: a flat map
 * from module id to `{enabled}`. Absent entries default to enabled,
 * matching the scanner's default behavior.
 */
export interface ModulesState {
  [moduleId: string]: { enabled: boolean };
}

export const STATE_DIR_NAME = '.forgekit';
export const STATE_FILE_NAME = 'modules_state.json';

/** Resolves the absolute path to the modules state file. */
export function stateFilePath(projectRoot: string): string {
  return join(projectRoot, STATE_DIR_NAME, STATE_FILE_NAME);
}

/**
 * Reads the state file, returning an empty map when the file does not
 * exist or cannot be parsed. I/O errors other than ENOENT bubble up.
 */
export async function readModulesState(
  projectRoot: string,
): Promise<ModulesState> {
  const path = stateFilePath(projectRoot);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ModulesState;
    }
  } catch {
    // Corrupt state file — fall through to empty map so the tool can
    // rebuild it from the current call.
  }
  return {};
}

/**
 * Atomically persists the state file. Creates the `.forgekit/`
 * directory on demand. Writes to `<path>.tmp` first and renames into
 * place so readers never see a truncated file.
 */
export async function writeModulesState(
  projectRoot: string,
  state: ModulesState,
): Promise<void> {
  const path = stateFilePath(projectRoot);
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmpPath, path);
}
