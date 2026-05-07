/**
 * Tests for the `project.reload` MCP tool.
 *
 * `project.reload` is an editor-channel operation. The server doesn't
 * reload Godot itself — it dispatches a `reload` RPC to the Editor
 * Plugin over WebSocket. At this server-layer level we accept a
 * `dispatch` dependency (swapped in tests with a fake) so the tool's
 * contract is verifiable in isolation. Phase 3 wires a real WebSocket
 * client into this same dispatch signature.
 *
 * The tool measures wall-clock duration from "dispatch" to "reply" and
 * surfaces it as `duration_ms`, which is what callers use to track
 * whether the reload kept up with their edits.
 */

import { describe, expect, it, vi } from 'vitest';

import { ToolInputError } from '../../../src/tools/project/errors.js';
import {
  projectReload,
  type ReloadDispatcher,
} from '../../../src/tools/project/reload.js';

describe('projectReload — happy path', () => {
  it('invokes the dispatcher and returns {reloaded: true, duration_ms}', async () => {
    const dispatch: ReloadDispatcher = vi
      .fn()
      .mockResolvedValue({ reloaded: true });
    const result = await projectReload({}, { dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result.reloaded).toBe(true);
    expect(typeof result.duration_ms).toBe('number');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('reports duration_ms at least as large as the dispatcher delay', async () => {
    const dispatch: ReloadDispatcher = () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ reloaded: true }), 20),
      );
    const result = await projectReload({}, { dispatch });
    expect(result.duration_ms).toBeGreaterThanOrEqual(20);
  });
});

describe('projectReload — error paths', () => {
  it('propagates the dispatcher rejection as-is', async () => {
    const dispatch: ReloadDispatcher = vi
      .fn()
      .mockRejectedValue(new Error('editor offline'));
    await expect(projectReload({}, { dispatch })).rejects.toThrow(
      'editor offline',
    );
  });

  it('raises ToolInputError when the dependency is missing (no transport wired)', async () => {
    // Passing `{}` as deps (no dispatcher) simulates the "transport not
    // connected yet" case. Callers must pass a dispatcher; the tool
    // refuses to silently no-op.
    await expect(projectReload({}, {})).rejects.toThrow(ToolInputError);
  });

  it('treats {reloaded: false} from the editor as reloaded=false', async () => {
    const dispatch: ReloadDispatcher = vi
      .fn()
      .mockResolvedValue({ reloaded: false });
    const result = await projectReload({}, { dispatch });
    expect(result.reloaded).toBe(false);
  });
});
