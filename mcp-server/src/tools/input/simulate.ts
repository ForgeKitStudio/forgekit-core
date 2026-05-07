/**
 * Server-side implementations of the four `input.simulate_*` MCP tools.
 *
 *   input.simulate_action(action, strength?, pressed?)       → runtime
 *   input.simulate_key(keycode, pressed, echo?)              → runtime
 *   input.simulate_mouse_button(button, pressed, position?)  → runtime
 *   input.simulate_mouse_motion(position, relative?)         → runtime
 *
 * These tools target the runtime channel: when the game was launched with
 * `--mcp-bridge`, the MCP_Runtime_Bridge receives a UDP JSON-RPC packet,
 * produces the matching `InputEvent` (via `Input.parse_input_event`), and
 * returns an acknowledgement. The server layer is a thin shim: validate
 * parameters, default omitted optional fields, forward to the dispatcher,
 * return the dispatcher reply verbatim.
 *
 * The `dispatch` dependency is injected so the tools are unit-testable
 * without a live UDP transport; Phase 3 wires a real UDP client into the
 * same signature.
 */

import { ToolInputError } from '../project/errors.js';

/**
 * Generic dispatcher for the simulate family. The concrete transport
 * (UDP client in Phase 3) knows how to route `method` to the runtime
 * bridge and deserialize the JSON-RPC reply.
 */
export type SimulateDispatcher = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface SimulateDeps {
  dispatch?: SimulateDispatcher;
}

// ---------------------------------------------------------------------------
// input.simulate_action
// ---------------------------------------------------------------------------

export interface SimulateActionParams {
  action: string;
  strength?: number;
  pressed?: boolean;
}

export interface SimulateActionResult {
  action?: string;
  strength?: number;
  pressed?: boolean;
  [key: string]: unknown;
}

export async function simulateAction(
  params: SimulateActionParams,
  deps: SimulateDeps,
): Promise<SimulateActionResult> {
  const dispatch = requireDispatcher(deps, 'input.simulate_action');
  requireNonBlankString(params.action, 'action');
  const strength = params.strength ?? 1.0;
  requireStrength(strength);
  const pressed = params.pressed ?? true;
  requireBoolean(pressed, 'pressed');

  const reply = await dispatch('input.simulate_action', {
    action: params.action,
    strength,
    pressed,
  });
  return reply as SimulateActionResult;
}

// ---------------------------------------------------------------------------
// input.simulate_key
// ---------------------------------------------------------------------------

export interface SimulateKeyParams {
  keycode: number;
  pressed: boolean;
  echo?: boolean;
}

export interface SimulateKeyResult {
  keycode?: number;
  pressed?: boolean;
  echo?: boolean;
  [key: string]: unknown;
}

export async function simulateKey(
  params: SimulateKeyParams,
  deps: SimulateDeps,
): Promise<SimulateKeyResult> {
  const dispatch = requireDispatcher(deps, 'input.simulate_key');
  requireNonNegativeInt(params.keycode, 'keycode');
  requireBoolean(params.pressed, 'pressed');
  const echo = params.echo ?? false;
  requireBoolean(echo, 'echo');

  const reply = await dispatch('input.simulate_key', {
    keycode: params.keycode,
    pressed: params.pressed,
    echo,
  });
  return reply as SimulateKeyResult;
}

// ---------------------------------------------------------------------------
// input.simulate_mouse_button
// ---------------------------------------------------------------------------

export interface SimulateMouseButtonParams {
  button: number;
  pressed: boolean;
  position?: [number, number];
}

export interface SimulateMouseButtonResult {
  button?: number;
  pressed?: boolean;
  position?: [number, number];
  [key: string]: unknown;
}

export async function simulateMouseButton(
  params: SimulateMouseButtonParams,
  deps: SimulateDeps,
): Promise<SimulateMouseButtonResult> {
  const dispatch = requireDispatcher(deps, 'input.simulate_mouse_button');
  requireNonNegativeInt(params.button, 'button');
  requireBoolean(params.pressed, 'pressed');
  const position = params.position ?? [0, 0];
  requireVec2(position, 'position');

  const reply = await dispatch('input.simulate_mouse_button', {
    button: params.button,
    pressed: params.pressed,
    position,
  });
  return reply as SimulateMouseButtonResult;
}

// ---------------------------------------------------------------------------
// input.simulate_mouse_motion
// ---------------------------------------------------------------------------

export interface SimulateMouseMotionParams {
  position: [number, number];
  relative?: [number, number];
}

export interface SimulateMouseMotionResult {
  position?: [number, number];
  relative?: [number, number];
  [key: string]: unknown;
}

export async function simulateMouseMotion(
  params: SimulateMouseMotionParams,
  deps: SimulateDeps,
): Promise<SimulateMouseMotionResult> {
  const dispatch = requireDispatcher(deps, 'input.simulate_mouse_motion');
  requireVec2(params.position, 'position');
  const relative = params.relative ?? [0, 0];
  requireVec2(relative, 'relative');

  const reply = await dispatch('input.simulate_mouse_motion', {
    position: params.position,
    relative,
  });
  return reply as SimulateMouseMotionResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireDispatcher(
  deps: SimulateDeps,
  toolName: string,
): SimulateDispatcher {
  if (typeof deps.dispatch !== 'function') {
    throw new ToolInputError(
      `${toolName} requires a runtime dispatcher; the UDP transport is not connected.`,
    );
  }
  return deps.dispatch;
}

function requireNonBlankString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
}

function requireBoolean(value: unknown, field: string): void {
  if (typeof value !== 'boolean') {
    throw new ToolInputError(
      `"${field}" must be a boolean (got ${typeof value}).`,
    );
  }
}

function requireNonNegativeInt(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ToolInputError(
      `"${field}" must be a non-negative integer (got ${JSON.stringify(value)}).`,
    );
  }
}

function requireStrength(value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(
      `"strength" must be a finite number in [0.0, 1.0] (got ${JSON.stringify(value)}).`,
    );
  }
  if (value < 0 || value > 1) {
    throw new ToolInputError(
      `"strength" must be within [0.0, 1.0] (got ${value}).`,
    );
  }
}

function requireVec2(value: unknown, field: string): void {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ToolInputError(
      `"${field}" must be a two-element [x, y] array (got ${JSON.stringify(value)}).`,
    );
  }
  for (const [i, component] of value.entries()) {
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw new ToolInputError(
        `"${field}[${i}]" must be a finite number (got ${JSON.stringify(component)}).`,
      );
    }
  }
}
