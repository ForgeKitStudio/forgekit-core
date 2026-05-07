/**
 * Tests for the three editor-channel Input MCP tools:
 * `input.list_actions`, `input.configure_action`, `input.remove_action`.
 *
 * All three dispatch to the editor plugin (WebSocket channel) so at the
 * server layer they accept a dispatch dependency and validate their
 * parameters before forwarding the call.
 *
 * `input.configure_action` is the fix for the tomyud1/godot-mcp bug
 * where `deadzone` was silently dropped on update. The server forwards
 * the `deadzone` field to the editor plugin verbatim; the plugin writes
 * it through `McpProjectSettingsAtomicWriter`. The server-layer
 * contract guarantees:
 *
 *   - when `deadzone` is supplied, the dispatch payload contains it;
 *   - when `deadzone` is omitted, the dispatch payload omits it — never
 *     substitutes 0.0 — so the plugin preserves the existing value.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  configureAction,
  listActions,
  removeAction,
  type EditorInputDispatcher,
} from '../../../src/tools/input/configure.js';
import { ToolInputError } from '../../../src/tools/project/errors.js';

// ---------------------------------------------------------------------------
// input.list_actions
// ---------------------------------------------------------------------------

describe('listActions', () => {
  it('dispatches with no parameters and returns {actions} from the plugin', async () => {
    const dispatch: EditorInputDispatcher = vi.fn().mockResolvedValue({
      actions: [
        { name: 'ui_accept', deadzone: 0.5, events: [] },
        { name: 'attack', deadzone: 0.2, events: [] },
      ],
    });
    const result = await listActions({}, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('input.list_actions', {});
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({ name: 'ui_accept' });
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(listActions({}, {})).rejects.toThrow(ToolInputError);
  });
});

// ---------------------------------------------------------------------------
// input.configure_action
// ---------------------------------------------------------------------------

describe('configureAction', () => {
  it('forwards action, events, and deadzone when supplied', async () => {
    const dispatch: EditorInputDispatcher = vi.fn().mockResolvedValue({
      applied: { events: [], deadzone: 0.25 },
      previous: { events: [], deadzone: 0.5 },
    });
    const result = await configureAction(
      {
        action: 'ui_accept',
        events: [{ type: 'key', keycode: 32 }],
        deadzone: 0.25,
      },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('input.configure_action', {
      action: 'ui_accept',
      events: [{ type: 'key', keycode: 32 }],
      deadzone: 0.25,
    });
    expect(result.applied.deadzone).toBe(0.25);
  });

  it('omits deadzone from the dispatch payload when the caller omits it (plugin preserves existing)', async () => {
    const dispatch: EditorInputDispatcher = vi.fn().mockResolvedValue({});
    await configureAction(
      { action: 'attack', events: [] },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('input.configure_action', {
      action: 'attack',
      events: [],
    });
  });

  it('forwards deadzone=0.0 explicitly when the caller passes it (not treated as "omitted")', async () => {
    const dispatch: EditorInputDispatcher = vi.fn().mockResolvedValue({});
    await configureAction(
      { action: 'attack', events: [], deadzone: 0.0 },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('input.configure_action', {
      action: 'attack',
      events: [],
      deadzone: 0.0,
    });
  });

  it('rejects empty action names', async () => {
    const dispatch: EditorInputDispatcher = vi.fn();
    await expect(
      configureAction({ action: '', events: [] }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects non-array events', async () => {
    const dispatch: EditorInputDispatcher = vi.fn();
    await expect(
      configureAction(
        { action: 'a', events: 'oops' as unknown as Array<Record<string, unknown>> },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects deadzone values outside [0.0, 1.0]', async () => {
    const dispatch: EditorInputDispatcher = vi.fn();
    await expect(
      configureAction(
        { action: 'a', events: [], deadzone: 1.5 },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    await expect(
      configureAction(
        { action: 'a', events: [], deadzone: -0.01 },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });
});

// ---------------------------------------------------------------------------
// input.remove_action
// ---------------------------------------------------------------------------

describe('removeAction', () => {
  it('forwards action and returns {removed: true} from the plugin', async () => {
    const dispatch: EditorInputDispatcher = vi.fn().mockResolvedValue({
      removed: true,
    });
    const result = await removeAction({ action: 'old_action' }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('input.remove_action', {
      action: 'old_action',
    });
    expect(result.removed).toBe(true);
  });

  it('rejects empty action names', async () => {
    const dispatch: EditorInputDispatcher = vi.fn();
    await expect(
      removeAction({ action: '' }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
  });
});
