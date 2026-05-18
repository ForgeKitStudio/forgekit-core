/**
 * MCP auth-token verifier — TypeScript port of the auth gate shared
 * between the editor plugin (WebSocket) and runtime bridge (UDP).
 *
 * Mirrors the auth portion of
 * `addons/forgekit_core/mcp/editor_plugin/json_rpc_dispatcher.gd`:
 * the dispatcher receives a per-request token and compares it against
 * the configured `auth_token`. A mismatch produces a JSON-RPC 2.0
 * error envelope with code `-32000` / message `UNAUTHORIZED` and
 * instructs the transport layer to close the connection.
 *
 * This module is pure: no sockets, no I/O. It exists so the Node-side
 * property test can sweep the invariant without spinning up Godot.
 */

/**
 * JSON-RPC error code for `UNAUTHORIZED`. Mirrors
 * `McpErrorCodes.UNAUTHORIZED` in
 * `addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd`.
 */
export const UNAUTHORIZED_CODE = -32000 as const;

/** Human-readable message paired with `UNAUTHORIZED`. */
export const UNAUTHORIZED_MESSAGE = 'UNAUTHORIZED' as const;

/** Default `data.suggestion` for `UNAUTHORIZED`. */
const UNAUTHORIZED_SUGGESTION =
  'Rotate the auth_token in plugin_config.tres / runtime_config.tres and retry with the matching token.';

/** JSON-RPC error envelope emitted by the auth gate on mismatch. */
export interface UnauthorizedError {
  readonly code: typeof UNAUTHORIZED_CODE;
  readonly message: typeof UNAUTHORIZED_MESSAGE;
  readonly data: {
    readonly suggestion: string;
  };
}

/** Outcome of the auth gate for a single request. */
export type AuthGateResult =
  | { readonly ok: true; readonly closeConnection: false }
  | {
    readonly ok: false;
    readonly closeConnection: true;
    readonly error: UnauthorizedError;
  };

/** Inputs consumed by {@link verifyAuthToken}. */
export interface AuthVerifyInput {
  /** Token carried by the incoming request (`t_req`). */
  readonly requestToken: string;
  /** Token configured in `auth_token` (`t_cfg`). */
  readonly configuredToken: string;
}

/**
 * Run the auth gate against a single request. Returns an accept
 * verdict when `requestToken === configuredToken`, otherwise a reject
 * verdict carrying a `-32000 UNAUTHORIZED` envelope and
 * `closeConnection: true` so the caller can tear down the transport.
 *
 * Comparison is strict string equality. Both tokens are treated as
 * opaque strings; callers are responsible for any upstream decoding
 * (e.g. stripping `Bearer ` from WS headers or reading `auth_token`
 * out of a UDP payload).
 */
export function verifyAuthToken(input: AuthVerifyInput): AuthGateResult {
  if (input.requestToken === input.configuredToken) {
    return { ok: true, closeConnection: false };
  }
  return {
    ok: false,
    closeConnection: true,
    error: {
      code: UNAUTHORIZED_CODE,
      message: UNAUTHORIZED_MESSAGE,
      data: {
        suggestion: UNAUTHORIZED_SUGGESTION,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// loadAuthToken — read auth_token from plugin_config.tres / runtime_config.tres
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Channel-specific path of the Godot auth-token resource file. */
const AUTH_TOKEN_FILE: Readonly<Record<'editor' | 'runtime', string>> = {
  editor: 'addons/forgekit_core/mcp/plugin_config.tres',
  runtime: 'addons/forgekit_core/mcp/runtime_config.tres',
};

/**
 * Match the `auth_token = "<value>"` line in a Godot text resource file.
 * The value capture is non-greedy so an explicit closing quote on the
 * same line terminates the match. The trailing `\s*$` (with `m` flag)
 * ensures that the line ends after the closing quote — a missing
 * closing quote falls through to the malformed-detection branch below.
 */
const AUTH_TOKEN_LINE = /^auth_token\s*=\s*"(.*?)"\s*$/m;

/** Standalone `auth_token = ` line used to detect malformed values. */
const AUTH_TOKEN_PRESENT = /^auth_token\s*=/m;

/** Options accepted by {@link loadAuthToken}. */
export interface LoadAuthTokenOptions {
  /** Project root directory containing the `addons/forgekit_core/mcp/` tree. */
  readonly projectRoot: string;
}

/**
 * Read the configured `auth_token` for the given MCP channel from the
 * Godot text resource file under `options.projectRoot`.
 *
 * Returns:
 *   - the trimmed token string when the field is present and non-empty
 *   - `null` when the file is missing, the `auth_token` field is
 *     absent, or the field value is the empty string (auth disabled
 *     / dev mode)
 *
 * Throws:
 *   - when the file is present but the `auth_token = ...` line is
 *     malformed (e.g. an unterminated quoted string), so that
 *     misconfiguration is loud rather than silently downgraded to
 *     dev-mode pass-through.
 */
export async function loadAuthToken(
  channel: 'editor' | 'runtime',
  options: LoadAuthTokenOptions,
): Promise<string | null> {
  const relativePath = AUTH_TOKEN_FILE[channel];
  const fullPath = join(options.projectRoot, relativePath);

  let contents: string;
  try {
    contents = await readFile(fullPath, 'utf8');
  } catch (err) {
    if (isFileNotFoundError(err)) {
      return null;
    }
    throw err;
  }

  const match = AUTH_TOKEN_LINE.exec(contents);
  if (match === null) {
    if (AUTH_TOKEN_PRESENT.test(contents)) {
      throw new Error(
        `Malformed auth_token line in ${relativePath}: expected \`auth_token = "<value>"\`.`,
      );
    }
    return null;
  }

  const raw = match[1] ?? '';
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  return trimmed;
}

/** Type-guard for Node `fs` ENOENT errors. */
function isFileNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  );
}
