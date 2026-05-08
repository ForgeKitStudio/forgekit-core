/**
 * MCP bind-address warning producer — TypeScript port of the
 * start-time safety warning shared between the editor plugin
 * (WebSocket) and runtime bridge (UDP).
 *
 * Mirrors the `bind_address` check performed by
 * `addons/forgekit_core/mcp/editor_plugin/websocket_server.gd` and
 * `addons/forgekit_core/mcp/runtime_bridge/udp_server.gd` on startup:
 * the server records a warning carrying the code
 * `EXTERNAL_BIND_ENABLED` and the configured `bind_address` whenever
 * the address differs from the loopback default. The warning does not
 * abort the start; it exists so operators know MCP traffic is now
 * reachable beyond the local host.
 *
 * This module is pure: no sockets, no I/O. It exists so the Node-side
 * property test can sweep the invariant without spinning up Godot.
 */

/** Loopback default baked into both GDScript servers. */
export const LOOPBACK_BIND_ADDRESS = '127.0.0.1' as const;

/** Warning code emitted for non-loopback `bind_address` values. */
export const EXTERNAL_BIND_ENABLED_CODE = 'EXTERNAL_BIND_ENABLED' as const;

/** Human-readable message paired with `EXTERNAL_BIND_ENABLED`. */
const EXTERNAL_BIND_ENABLED_MESSAGE =
  'Server is bound to a non-loopback address; MCP traffic is exposed to the network.';

/** Single warning entry recorded by the startup producer. */
export interface StartupWarning {
  readonly code: typeof EXTERNAL_BIND_ENABLED_CODE;
  readonly bind_address: string;
  readonly message: string;
}

/** Inputs consumed by {@link buildStartupWarnings}. */
export interface BindWarningInput {
  /** Configured `bind_address` from `plugin_config.tres` / `runtime_config.tres`. */
  readonly bindAddress: string;
}

/**
 * Build the startup warnings array for a single server instance.
 * Returns an empty array when `bindAddress` equals the loopback
 * default, otherwise a one-element array containing an
 * `EXTERNAL_BIND_ENABLED` warning whose `bind_address` echoes the
 * configured value.
 */
export function buildStartupWarnings(
  input: BindWarningInput,
): readonly StartupWarning[] {
  if (input.bindAddress === LOOPBACK_BIND_ADDRESS) {
    return [];
  }
  return [
    {
      code: EXTERNAL_BIND_ENABLED_CODE,
      bind_address: input.bindAddress,
      message: EXTERNAL_BIND_ENABLED_MESSAGE,
    },
  ];
}
