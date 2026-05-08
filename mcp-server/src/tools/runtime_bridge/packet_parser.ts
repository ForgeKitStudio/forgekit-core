/**
 * MCP runtime bridge — UDP packet parser (TypeScript port of the size
 * gate).
 *
 * Mirrors the size-gate portion of the GDScript producer shipped in
 * `addons/forgekit_core/mcp/runtime_bridge/packet_parser.gd`. The
 * runtime bridge measures every incoming datagram before any decode
 * step and rejects datagrams larger than `max_packet_bytes` (default
 * 65507 — the IPv4 UDP payload ceiling) with a JSON-RPC 2.0 error
 * envelope:
 *
 *   { code: -32005,
 *     message: "PACKET_TOO_LARGE",
 *     data: { size: <bytes>, limit: <max_packet_bytes>, suggestion: <text> } }
 *
 * This module exposes only what the size-gate contract needs: the
 * constants that downstream callers (and property tests) cross-check
 * against, plus `parsePacketSize(size)` — a pure, allocation-free
 * stand-in for `McpRuntimePacketParser.parse()` that lets Node-side
 * tests sweep the size invariant without spawning headless Godot.
 */

/**
 * JSON-RPC error code for `PACKET_TOO_LARGE`. Mirrors
 * `McpErrorCodes.PACKET_TOO_LARGE` in
 * `addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd`.
 */
export const PACKET_TOO_LARGE_CODE = -32005 as const;

/** Human-readable message paired with `PACKET_TOO_LARGE`. */
export const PACKET_TOO_LARGE_MESSAGE = 'PACKET_TOO_LARGE' as const;

/**
 * Default maximum datagram size in bytes — the IPv4 UDP payload
 * ceiling. 65535 (datagram) − 8 (UDP header) − 20 (IPv4 header) =
 * 65507. Kept here so downstream callers and tests reference the
 * same source of truth as the GDScript parser's
 * `DEFAULT_MAX_PACKET_BYTES`.
 */
export const DEFAULT_MAX_PACKET_BYTES = 65_507 as const;

/** Default `data.suggestion` for `PACKET_TOO_LARGE`. */
const PACKET_TOO_LARGE_SUGGESTION =
  'Split the request payload; the runtime bridge accepts up to 65507 bytes per UDP datagram.';

/** JSON-RPC error envelope for the size gate. */
export interface PacketTooLargeError {
  readonly code: typeof PACKET_TOO_LARGE_CODE;
  readonly message: typeof PACKET_TOO_LARGE_MESSAGE;
  readonly data: {
    readonly size: number;
    readonly limit: number;
    readonly suggestion: string;
  };
}

/** Outcome of the size gate for a single datagram length. */
export type SizeGateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: PacketTooLargeError };

/**
 * Run the size gate against a datagram of byte length `size`. Returns
 * `{ ok: true }` when `size <= limit`, otherwise a `PACKET_TOO_LARGE`
 * envelope carrying `data.size === size` and `data.limit === limit`.
 *
 * `limit` defaults to {@link DEFAULT_MAX_PACKET_BYTES}; callers pass a
 * smaller value to mirror a runtime config with a tightened ceiling.
 */
export function parsePacketSize(
  size: number,
  limit: number = DEFAULT_MAX_PACKET_BYTES,
): SizeGateResult {
  if (size > limit) {
    return {
      ok: false,
      error: {
        code: PACKET_TOO_LARGE_CODE,
        message: PACKET_TOO_LARGE_MESSAGE,
        data: {
          size,
          limit,
          suggestion: PACKET_TOO_LARGE_SUGGESTION,
        },
      },
    };
  }
  return { ok: true };
}
