/**
 * Implementation of the `project.reload` MCP tool.
 *
 * `project.reload` is an editor-channel operation: the server asks the
 * running Editor Plugin to rescan the filesystem and reload cached
 * resources. This server-layer implementation accepts a `dispatch`
 * dependency so it can be exercised without a live WebSocket transport.
 * Phase 3 plugs a real WebSocket client into the same signature.
 *
 * The tool returns `{reloaded, duration_ms}` where `duration_ms` is the
 * wall-clock time between dispatching the RPC and receiving the reply,
 * rounded to the nearest millisecond. Callers use it to watch for slow
 * reloads on large projects.
 */

import { ToolInputError } from './errors.js';

export type ReloadDispatcher = () => Promise<{ reloaded: boolean }>;

export interface ReloadDeps {
  dispatch?: ReloadDispatcher;
}

export interface ReloadParams {
  // No parameters today. The shape is reserved so future flags (e.g.
  // `force: boolean`) can be added without breaking the JSON-RPC
  // contract.
}

export interface ReloadResult {
  reloaded: boolean;
  duration_ms: number;
}

export async function projectReload(
  _params: ReloadParams,
  deps: ReloadDeps,
): Promise<ReloadResult> {
  if (typeof deps.dispatch !== 'function') {
    throw new ToolInputError(
      'project.reload requires an editor dispatcher; the WebSocket transport is not connected.',
    );
  }
  const start = process.hrtime.bigint();
  const reply = await deps.dispatch();
  const elapsedNs = process.hrtime.bigint() - start;
  const duration_ms = Math.round(Number(elapsedNs) / 1_000_000);
  return { reloaded: Boolean(reply.reloaded), duration_ms };
}
