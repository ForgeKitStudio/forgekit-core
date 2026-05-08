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
