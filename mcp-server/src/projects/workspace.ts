/**
 * Workspace value type and its pure validation helpers.
 *
 * A `Workspace` is the immutable metadata record the `ProjectRegistry`
 * keeps for every registered Godot project. The record is built once at
 * `register` time; the only field that mutates directly is `active`,
 * and only through `ProjectRegistry.setActive`.
 *
 * The `validate*` helpers are pure functions used by the registry and
 * the dispatcher middleware to reject malformed inputs before any
 * filesystem work is attempted.
 */

/**
 * Canonical workspace identifier grammar:
 *   - lowercase alphanumeric, dash, and underscore
 *   - must start with a letter
 *   - total length 1 to 64 characters
 */
export const WORKSPACE_ID_REGEX = /^[a-z][a-z0-9_-]{0,63}$/;

/** Maximum number of concurrently registered workspaces. */
export const MAX_WORKSPACES = 32;

/** Maximum length in characters for the optional human-readable label. */
export const MAX_LABEL_LENGTH = 120;

/** Immutable metadata for a single registered Godot project. */
export interface Workspace {
  readonly workspace_id: string;
  readonly projectRoot: string;
  readonly label?: string;
  readonly registered_at: string;
  active: boolean;
}

/** Union-style result returned by the validators. */
export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Validate a workspace id against WORKSPACE_ID_REGEX. Returns a
 * structured result instead of throwing so callers can translate the
 * reason into a JSON-RPC error envelope of their choice.
 */
export function validateWorkspaceId(value: unknown): ValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, reason: 'workspace_id must be a string.' };
  }
  if (value === '') {
    return { valid: false, reason: 'workspace_id must not be empty.' };
  }
  if (!WORKSPACE_ID_REGEX.test(value)) {
    return {
      valid: false,
      reason:
        `workspace_id must match ${WORKSPACE_ID_REGEX.source} ` +
        '(lowercase letters, digits, dash, underscore; first char a letter; 1 to 64 characters).',
    };
  }
  return { valid: true };
}

/**
 * Validate the optional workspace label. `undefined` is treated as
 * absent and is valid. Non-string values and oversized strings are
 * rejected with a reason.
 */
export function validateLabel(value: unknown): ValidationResult {
  if (value === undefined) {
    return { valid: true };
  }
  if (typeof value !== 'string') {
    return { valid: false, reason: 'label must be a string or undefined.' };
  }
  if (value.length > MAX_LABEL_LENGTH) {
    return {
      valid: false,
      reason: `label length ${value.length} exceeds max ${MAX_LABEL_LENGTH}.`,
    };
  }
  return { valid: true };
}
