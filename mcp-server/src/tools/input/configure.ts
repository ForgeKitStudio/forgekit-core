/**
 * Server-side implementations of the three editor-channel Input MCP tools:
 *
 *   input.list_actions()                               → {actions: [...]}
 *   input.configure_action(action, events, deadzone?)  → {applied, previous}
 *   input.remove_action(action)                        → {removed: true}
 *
 * These three tools target the editor channel (WebSocket). The server
 * layer is a thin shim: validate parameters, forward the call to the
 * injected dispatcher that talks to the editor plugin, return the
 * plugin's reply verbatim. The plugin is the authoritative side that
 * reads `InputMap.get_actions()` and writes `input/<action>` entries in
 * `project.godot` through `McpProjectSettingsAtomicWriter`.
 *
 * `input.configure_action` intentionally forwards `deadzone` verbatim
 * when supplied, and omits it from the payload when not supplied. This
 * is the fix for the tomyud1/godot-mcp regression where `deadzone` was
 * silently dropped on update: when the caller omits the field, the
 * plugin preserves the existing on-disk value instead of substituting
 * `0.0`. Passing `deadzone: 0.0` explicitly is honored.
 */

import { ToolInputError } from '../project/errors.js';

/**
 * Generic dispatcher for editor-channel input tools. The concrete
 * transport (WebSocket client in Phase 2) knows how to route `method`
 * to the editor plugin and deserialize the JSON-RPC reply.
 */
export type EditorInputDispatcher = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface EditorInputDeps {
  dispatch?: EditorInputDispatcher;
}

// ---------------------------------------------------------------------------
// input.list_actions
// ---------------------------------------------------------------------------

export interface ListActionsParams {}

export interface InputActionDescriptor {
  name: string;
  deadzone?: number;
  events?: Array<Record<string, unknown>>;
}

export interface ListActionsResult {
  actions: InputActionDescriptor[];
}

export async function listActions(
  _params: ListActionsParams,
  deps: EditorInputDeps,
): Promise<ListActionsResult> {
  const dispatch = requireDispatcher(deps, 'input.list_actions');
  const reply = await dispatch('input.list_actions', {});
  const actions = Array.isArray(reply.actions)
    ? (reply.actions as InputActionDescriptor[])
    : [];
  return { actions };
}

// ---------------------------------------------------------------------------
// input.configure_action
// ---------------------------------------------------------------------------

export interface ConfigureActionParams {
  action: string;
  events: Array<Record<string, unknown>>;
  deadzone?: number;
}

export interface ConfigureActionResult {
  applied: {
    events?: Array<Record<string, unknown>>;
    deadzone?: number;
    [key: string]: unknown;
  };
  previous: {
    events?: Array<Record<string, unknown>>;
    deadzone?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function configureAction(
  params: ConfigureActionParams,
  deps: EditorInputDeps,
): Promise<ConfigureActionResult> {
  const dispatch = requireDispatcher(deps, 'input.configure_action');
  requireNonBlankString(params.action, 'action');
  requireEventsArray(params.events, 'events');

  // Only include `deadzone` in the dispatch payload when the caller
  // supplied it. Omitting the key signals to the plugin that the
  // existing on-disk deadzone must be preserved — this is the tomyud1
  // fix. We distinguish "omitted" from "undefined" by checking `in`.
  const payload: Record<string, unknown> = {
    action: params.action,
    events: params.events,
  };
  if ('deadzone' in params && params.deadzone !== undefined) {
    requireDeadzone(params.deadzone);
    payload.deadzone = params.deadzone;
  }

  const reply = await dispatch('input.configure_action', payload);
  return reply as ConfigureActionResult;
}

// ---------------------------------------------------------------------------
// input.remove_action
// ---------------------------------------------------------------------------

export interface RemoveActionParams {
  action: string;
}

export interface RemoveActionResult {
  removed: boolean;
  [key: string]: unknown;
}

export async function removeAction(
  params: RemoveActionParams,
  deps: EditorInputDeps,
): Promise<RemoveActionResult> {
  const dispatch = requireDispatcher(deps, 'input.remove_action');
  requireNonBlankString(params.action, 'action');

  const reply = await dispatch('input.remove_action', { action: params.action });
  return {
    removed: Boolean(reply.removed),
    ...reply,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireDispatcher(
  deps: EditorInputDeps,
  toolName: string,
): EditorInputDispatcher {
  if (typeof deps.dispatch !== 'function') {
    throw new ToolInputError(
      `${toolName} requires an editor dispatcher; the WebSocket transport is not connected.`,
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

function requireEventsArray(value: unknown, field: string): void {
  if (!Array.isArray(value)) {
    throw new ToolInputError(
      `"${field}" must be an array of event descriptors (got ${typeof value}).`,
    );
  }
}

function requireDeadzone(value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(
      `"deadzone" must be a finite number in [0.0, 1.0] (got ${JSON.stringify(value)}).`,
    );
  }
  if (value < 0 || value > 1) {
    throw new ToolInputError(
      `"deadzone" must be within [0.0, 1.0] (got ${value}).`,
    );
  }
}
