/**
 * Server-side implementations of the editor-channel Animation MCP tools:
 *
 *   animation.list(player_path)           → {animations: [...]}
 *   animation.play(player_path, name,
 *                  speed?)                → {playing, name}
 *   animation.stop(player_path)           → {stopped: true}
 *   animation.add_track(player_path,
 *                       animation_name,
 *                       track_type, path) → {track_index, undo_action_id?}
 *
 * These tools target the editor channel (WebSocket). They inspect or
 * drive a target `AnimationPlayer` node inside the currently edited
 * scene: `list` enumerates animations registered on the player, `play`
 * starts playback of a named animation with an optional speed scale,
 * `stop` halts playback, and `add_track` appends a new track to a named
 * animation on the player.
 *
 * The first three tools never change state on disk, so they do not
 * pass through `Undo_Redo_Wrapper`. `add_track` mutates an animation
 * resource, so the plugin routes it through `Undo_Redo_Wrapper`; the
 * server layer stays a thin shim that validates parameters and
 * forwards the plugin reply verbatim. The plugin is the authoritative
 * side that resolves `player_path` against `EditorInterface`,
 * interacts with `AnimationPlayer`, and performs the UndoRedo
 * bookkeeping. The shim does not constrain `track_type` so new Godot
 * track kinds become usable without a server release.
 *
 * The `speed` parameter on `animation.play` defaults to `1.0` when the
 * caller omits it. The shim always forwards a numeric `speed` so the
 * wire contract is explicit and matches the GDScript adapter at
 * `addons/forgekit_core/mcp/editor_plugin/tools/animation_tools.gd`,
 * which also defaults `speed` to `1.0`.
 */

import { ToolInputError } from '../project/errors.js';

/**
 * Generic dispatcher for editor-channel animation tools. The concrete
 * transport (WebSocket client in the editor bridge) knows how to route
 * `method` to the editor plugin and deserialize the JSON-RPC reply.
 */
export type AnimationDispatcher = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface AnimationDeps {
  dispatch?: AnimationDispatcher;
}

// ---------------------------------------------------------------------------
// animation.list
// ---------------------------------------------------------------------------

export interface ListAnimationsParams {
  /** Path to the target `AnimationPlayer` node in the edited scene. */
  player_path: string;
}

export interface AnimationDescriptor {
  name: string;
  length?: number;
  loop_mode?: string;
  [key: string]: unknown;
}

export interface ListAnimationsResult {
  animations?: ReadonlyArray<AnimationDescriptor>;
  [key: string]: unknown;
}

export async function listAnimations(
  params: ListAnimationsParams,
  deps: AnimationDeps,
): Promise<ListAnimationsResult> {
  const dispatch = requireDispatcher(deps, 'animation.list');
  requireNonBlankString(params.player_path, 'player_path');
  const reply = await dispatch('animation.list', {
    player_path: params.player_path,
  });
  return reply as ListAnimationsResult;
}

// ---------------------------------------------------------------------------
// animation.play
// ---------------------------------------------------------------------------

export interface PlayAnimationParams {
  /** Path to the target `AnimationPlayer` node in the edited scene. */
  player_path: string;
  /** Name of an animation already registered on the player. */
  name: string;
  /**
   * Speed scale applied to playback. Defaults to `1.0` when omitted.
   * Negative values play the animation in reverse; the shim forwards
   * any finite value verbatim and the plugin is the authoritative
   * validator for player-side constraints.
   */
  speed?: number;
}

export interface PlayAnimationResult {
  playing?: boolean;
  name?: string;
  [key: string]: unknown;
}

export async function playAnimation(
  params: PlayAnimationParams,
  deps: AnimationDeps,
): Promise<PlayAnimationResult> {
  const dispatch = requireDispatcher(deps, 'animation.play');
  requireNonBlankString(params.player_path, 'player_path');
  requireNonBlankString(params.name, 'name');

  const speed = params.speed === undefined ? 1.0 : params.speed;
  requireFiniteNumber(speed, 'speed');

  const reply = await dispatch('animation.play', {
    player_path: params.player_path,
    name: params.name,
    speed,
  });
  return reply as PlayAnimationResult;
}

// ---------------------------------------------------------------------------
// animation.stop
// ---------------------------------------------------------------------------

export interface StopAnimationParams {
  /** Path to the target `AnimationPlayer` node in the edited scene. */
  player_path: string;
}

export interface StopAnimationResult {
  stopped?: boolean;
  [key: string]: unknown;
}

export async function stopAnimation(
  params: StopAnimationParams,
  deps: AnimationDeps,
): Promise<StopAnimationResult> {
  const dispatch = requireDispatcher(deps, 'animation.stop');
  requireNonBlankString(params.player_path, 'player_path');
  const reply = await dispatch('animation.stop', {
    player_path: params.player_path,
  });
  return reply as StopAnimationResult;
}

// ---------------------------------------------------------------------------
// animation.add_track
// ---------------------------------------------------------------------------

export interface AddAnimationTrackParams {
  /** Path to the target `AnimationPlayer` node in the edited scene. */
  player_path: string;
  /** Name of an animation already registered on the player. */
  animation_name: string;
  /**
   * Godot track kind (e.g. `value`, `position_3d`, `rotation_3d`,
   * `scale_3d`, `blend_shape`, `method`, `bezier`, `audio`,
   * `animation`). The shim does not validate the string; the plugin is
   * the authoritative side that maps it to `Animation.TrackType`.
   */
  track_type: string;
  /** NodePath the new track targets, relative to the scene root. */
  path: string;
}

export interface AddAnimationTrackResult {
  /** Index of the newly created track inside the animation. */
  track_index?: number;
  /**
   * Identifier of the `EditorUndoRedoManager` action the plugin
   * produced when wrapping the mutation. Optional because some plugin
   * builds may not surface it.
   */
  undo_action_id?: number;
  [key: string]: unknown;
}

export async function addAnimationTrack(
  params: AddAnimationTrackParams,
  deps: AnimationDeps,
): Promise<AddAnimationTrackResult> {
  const dispatch = requireDispatcher(deps, 'animation.add_track');
  requireNonBlankString(params.player_path, 'player_path');
  requireNonBlankString(params.animation_name, 'animation_name');
  requireNonBlankString(params.track_type, 'track_type');
  requireNonBlankString(params.path, 'path');
  const reply = await dispatch('animation.add_track', {
    player_path: params.player_path,
    animation_name: params.animation_name,
    track_type: params.track_type,
    path: params.path,
  });
  return reply as AddAnimationTrackResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireDispatcher(
  deps: AnimationDeps,
  toolName: string,
): AnimationDispatcher {
  if (typeof deps.dispatch !== 'function') {
    throw new ToolInputError(
      `${toolName} requires an editor dispatcher; the WebSocket transport is not connected.`,
    );
  }
  return deps.dispatch;
}

function requireNonBlankString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
}

function requireFiniteNumber(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(
      `"${field}" must be a finite number (got ${JSON.stringify(value)}).`,
    );
  }
}
