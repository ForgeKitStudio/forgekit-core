/**
 * Core Boundary guard for the MCP server.
 *
 * Mirrors `addons/forgekit_core/boundary/core_boundary.gd`: any path
 * rooted under `addons/forgekit_core/` or `addons/gut/` is off-limits
 * for agent-driven writes. Every MCP tool that touches the file
 * system runs the target path through {@link violationFor} before
 * committing the write. A non-null return is thrown verbatim as the
 * JSON-RPC error payload for `CORE_BOUNDARY_VIOLATION` (code `-32002`).
 *
 * The boundary exists so that ForgeKit Core (and vendored addons like
 * GUT) can be upgraded by swapping directories wholesale rather than
 * by editing them in place. Client code — including
 * `addons/forgekit_rpg/` and everything outside `addons/` — stays
 * writable.
 */

/** JSON-RPC error code for boundary violations, shared with GDScript. */
export const CORE_BOUNDARY_VIOLATION_CODE = -32002 as const;

/** JSON-RPC error message string. */
export const CORE_BOUNDARY_VIOLATION_MESSAGE = 'CORE_BOUNDARY_VIOLATION' as const;

/**
 * Directory roots the MCP server must never write into. Matched by
 * prefix against the normalized input path (after stripping a leading
 * `res://` and any leading slashes).
 */
export const READ_ONLY_PATHS: readonly string[] = Object.freeze([
  'addons/forgekit_core/',
  'addons/gut/',
]);

/**
 * Glob-style patterns for fine-grained rejection. `**` matches any
 * number of path segments, `*` matches any characters except `/`.
 */
export const DENY_WRITE_PATTERNS: readonly string[] = Object.freeze([
  'addons/forgekit_core/**',
  'addons/forgekit_core/**/*.gd',
  'addons/forgekit_core/**/*.tres',
  'addons/forgekit_core/**/*.tscn',
  'addons/gut/**',
]);

/** Shape of a JSON-RPC error payload returned to the MCP client. */
export interface CoreBoundaryViolation {
  readonly code: typeof CORE_BOUNDARY_VIOLATION_CODE;
  readonly message: typeof CORE_BOUNDARY_VIOLATION_MESSAGE;
  readonly data: {
    readonly path: string;
    readonly matched_rule: string;
  };
}

/**
 * Returns the boundary-aware form of a path: `res://` prefix and
 * leading slashes stripped, backslashes normalised to forward slashes.
 * Callers may pass a fully-qualified `res://` URI, a project-relative
 * path (`addons/forgekit_core/plugin.cfg`), or an absolute OS path.
 * For absolute OS paths we look for the first `addons/` segment and
 * match from there; paths without any `addons/` segment cannot be
 * inside the boundary and are returned as-is so the pattern matcher
 * simply fails to find a match.
 */
function normalize(path: string): string {
  let out = path.replace(/\\/g, '/');
  if (out.startsWith('res://')) {
    out = out.slice('res://'.length);
  }
  while (out.startsWith('/')) {
    out = out.slice(1);
  }
  const marker = 'addons/';
  const idx = out.indexOf(marker);
  if (idx > 0) {
    out = out.slice(idx);
  }
  return out;
}

/**
 * Returns a violation payload when `path` falls inside the boundary,
 * or `null` when the write is allowed. `data.path` echoes the
 * original, un-normalised input so the client sees exactly the path
 * it asked to write.
 */
export function violationFor(path: string): CoreBoundaryViolation | null {
  const normalized = normalize(path);
  for (const root of READ_ONLY_PATHS) {
    const trimmed = root.endsWith('/') ? root.slice(0, -1) : root;
    if (normalized === trimmed || normalized.startsWith(root)) {
      return buildViolation(path, root);
    }
  }
  for (const pattern of DENY_WRITE_PATTERNS) {
    if (globMatch(pattern, normalized)) {
      return buildViolation(path, pattern);
    }
  }
  return null;
}

/**
 * Runs the guard and throws the violation payload verbatim when the
 * path is denied. Intended to be called at the top of every mutating
 * MCP tool so the dispatcher propagates the error unchanged.
 */
export function enforceBoundary(path: string): void {
  const violation = violationFor(path);
  if (violation !== null) {
    // Thrown as a plain object so the dispatcher can forward it
    // directly as the JSON-RPC error body.
    throw violation;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildViolation(
  rawPath: string,
  rule: string,
): CoreBoundaryViolation {
  return {
    code: CORE_BOUNDARY_VIOLATION_CODE,
    message: CORE_BOUNDARY_VIOLATION_MESSAGE,
    data: {
      path: rawPath,
      matched_rule: rule,
    },
  };
}

/**
 * Minimal glob matcher supporting `**` (any path segments, including
 * none and including `/`) and `*` (any characters except `/`). Built
 * by converting the glob into an anchored regular expression. The
 * current patterns only need these two wildcards.
 */
function globMatch(pattern: string, value: string): boolean {
  let regex = '^';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*';
        i += 2;
        // Collapse `**/` so a pattern like `foo/**/bar` matches
        // `foo/bar` as well as `foo/x/y/bar`.
        if (pattern[i] === '/') {
          i += 1;
        }
      } else {
        regex += '[^/]*';
        i += 1;
      }
    } else if ('.+?^${}()|[]\\'.includes(ch)) {
      regex += '\\' + ch;
      i += 1;
    } else {
      regex += ch;
      i += 1;
    }
  }
  regex += '$';
  return new RegExp(regex).test(value);
}
