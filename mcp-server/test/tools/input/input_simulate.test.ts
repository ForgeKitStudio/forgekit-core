/**
 * Tests for the four `input.simulate_*` MCP tools.
 *
 * The simulate family targets the runtime channel. The MCP server
 * validates parameters, forwards the call to an injected dispatcher
 * that talks to the MCP Runtime Bridge (UDP), and returns the
 * bridge's reply verbatim. At this server-layer level we accept a
 * `dispatch` dependency so the tool contract is verifiable in
 * isolation; Phase 3 plugs a real UDP client into the same shape.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  simulateAction,
  simulateKey,
  simulateMouseButton,
  simulateMouseMotion,
  type SimulateDispatcher,
} from '../../../src/tools/input/simulate.js';
import { ToolInputError } from '../../../src/tools/project/errors.js';

// ---------------------------------------------------------------------------
// input.simulate_action
// ---------------------------------------------------------------------------

describe('simulateAction', () => {
  it('forwards action, strength, pressed and returns the dispatcher reply', async () => {
    const dispatch: SimulateDispatcher = vi.fn().mockResolvedValue({
      action: 'attack',
      strength: 0.75,
      pressed: true,
    });
    const result = await simulateAction(
      { action: 'attack', strength: 0.75, pressed: true },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('input.simulate_action', {
      action: 'attack',
      strength: 0.75,
      pressed: true,
    });
    expect(result).toEqual({ action: 'attack', strength: 0.75, pressed: true });
  });

  it('defaults strength to 1.0 and pressed to true when omitted', async () => {
    const dispatch: SimulateDispatcher = vi.fn().mockResolvedValue({});
    await simulateAction({ action: 'ui_accept' }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('input.simulate_action', {
      action: 'ui_accept',
      strength: 1.0,
      pressed: true,
    });
  });

  it('rejects empty action names', async () => {
    const dispatch: SimulateDispatcher = vi.fn();
    await expect(
      simulateAction({ action: '' }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects strength values outside [0.0, 1.0]', async () => {
    const dispatch: SimulateDispatcher = vi.fn();
    await expect(
      simulateAction({ action: 'a', strength: 1.5 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    await expect(
      simulateAction({ action: 'a', strength: -0.1 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      simulateAction({ action: 'a' }, {} as { dispatch?: SimulateDispatcher }),
    ).rejects.toThrow(ToolInputError);
  });
});

// ---------------------------------------------------------------------------
// input.simulate_key
// ---------------------------------------------------------------------------

describe('simulateKey', () => {
  it('forwards keycode, pressed, echo and returns the dispatcher reply', async () => {
    const dispatch: SimulateDispatcher = vi.fn().mockResolvedValue({
      keycode: 32,
      pressed: true,
      echo: false,
    });
    const result = await simulateKey(
      { keycode: 32, pressed: true, echo: false },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('input.simulate_key', {
      keycode: 32,
      pressed: true,
      echo: false,
    });
    expect(result).toEqual({ keycode: 32, pressed: true, echo: false });
  });

  it('defaults echo to false when omitted', async () => {
    const dispatch: SimulateDispatcher = vi.fn().mockResolvedValue({});
    await simulateKey({ keycode: 65, pressed: true }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('input.simulate_key', {
      keycode: 65,
      pressed: true,
      echo: false,
    });
  });

  it('rejects non-integer keycodes and negative values', async () => {
    const dispatch: SimulateDispatcher = vi.fn();
    await expect(
      simulateKey(
        { keycode: 1.5 as unknown as number, pressed: true },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    await expect(
      simulateKey({ keycode: -1, pressed: true }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
  });
});

// ---------------------------------------------------------------------------
// input.simulate_mouse_button
// ---------------------------------------------------------------------------

describe('simulateMouseButton', () => {
  it('forwards button, pressed, position', async () => {
    const dispatch: SimulateDispatcher = vi.fn().mockResolvedValue({
      button: 1,
      pressed: true,
      position: [320, 240],
    });
    const result = await simulateMouseButton(
      { button: 1, pressed: true, position: [320, 240] },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('input.simulate_mouse_button', {
      button: 1,
      pressed: true,
      position: [320, 240],
    });
    expect(result).toEqual({
      button: 1,
      pressed: true,
      position: [320, 240],
    });
  });

  it('defaults position to [0, 0] when omitted', async () => {
    const dispatch: SimulateDispatcher = vi.fn().mockResolvedValue({});
    await simulateMouseButton({ button: 1, pressed: false }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('input.simulate_mouse_button', {
      button: 1,
      pressed: false,
      position: [0, 0],
    });
  });

  it('rejects non-integer buttons, position length != 2', async () => {
    const dispatch: SimulateDispatcher = vi.fn();
    await expect(
      simulateMouseButton(
        { button: 1.5 as unknown as number, pressed: true },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    await expect(
      simulateMouseButton(
        { button: 1, pressed: true, position: [1, 2, 3] as unknown as [number, number] },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });
});

// ---------------------------------------------------------------------------
// input.simulate_mouse_motion
// ---------------------------------------------------------------------------

describe('simulateMouseMotion', () => {
  it('forwards position and relative', async () => {
    const dispatch: SimulateDispatcher = vi.fn().mockResolvedValue({
      position: [100, 50],
      relative: [10, -5],
    });
    const result = await simulateMouseMotion(
      { position: [100, 50], relative: [10, -5] },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('input.simulate_mouse_motion', {
      position: [100, 50],
      relative: [10, -5],
    });
    expect(result).toEqual({ position: [100, 50], relative: [10, -5] });
  });

  it('defaults relative to [0, 0] when omitted', async () => {
    const dispatch: SimulateDispatcher = vi.fn().mockResolvedValue({});
    await simulateMouseMotion({ position: [1, 2] }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('input.simulate_mouse_motion', {
      position: [1, 2],
      relative: [0, 0],
    });
  });

  it('rejects missing or malformed position', async () => {
    const dispatch: SimulateDispatcher = vi.fn();
    await expect(
      simulateMouseMotion(
        {} as { position: [number, number] },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    await expect(
      simulateMouseMotion(
        { position: [1] as unknown as [number, number] },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
  });
});
