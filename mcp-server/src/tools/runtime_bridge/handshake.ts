/**
 * Runtime-channel handshake helpers.
 *
 * The runtime bridge's `runtime.handshake` tool lives on the GDScript
 * side (`addons/forgekit_core/mcp/runtime_bridge/tools/diagnostic_tools.gd`).
 * Its response carries a `server.latest_version` field that the server
 * populates from the editor plugin's periodic update-check cache
 * written by `McpUpdateChecker`.
 *
 * This module exposes a small helper so the runtime bridge can read
 * the cached latest version without duplicating the cache-format
 * knowledge. Returns `null` when no newer version has been recorded;
 * the handshake then emits `server.latest_version: null` to signal
 * "no newer version known".
 */

import { readFile } from 'node:fs/promises';

/** Shape written by `McpUpdateChecker._write_cache()`. */
interface UpdateCheckCache {
  last_unix_seconds?: number;
  last_result?: {
    ok?: boolean;
    checked?: boolean;
    update_available?: boolean;
    latest_version?: string;
    current_version?: string;
  };
}

/**
 * Read `path` (typically
 * `$USER/mcp_update_check.json` on the Godot side, or a
 * test-supplied override) and return the cached `latest_version`
 * string when an update is available. Returns `null` in every other
 * case (file missing, malformed, no update flagged) so the handshake
 * can surface the field as `null` without duplicating the parsing
 * logic.
 */
export async function readLatestVersionFromCache(
  path: string,
): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  let parsed: UpdateCheckCache;
  try {
    parsed = JSON.parse(raw) as UpdateCheckCache;
  } catch {
    return null;
  }
  const result = parsed.last_result;
  if (result === undefined) {
    return null;
  }
  if (!result.update_available) {
    return null;
  }
  const latest = result.latest_version;
  if (typeof latest !== 'string' || latest.trim() === '') {
    return null;
  }
  return latest;
}
