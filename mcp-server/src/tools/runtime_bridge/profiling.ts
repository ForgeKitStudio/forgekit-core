/**
 * Server-side implementations of the runtime-channel profiling MCP tools.
 *
 *   profiling.get_performance_monitors(monitors?)  → runtime
 *   profiling.get_frame_stats(window_frames?)      → runtime
 *
 * Both tools target the runtime channel: when the game was launched with
 * `--mcp-bridge`, the MCP_Runtime_Bridge receives a UDP JSON-RPC packet,
 * samples the live Godot `Performance` monitors or the per-frame sample
 * ring buffer, and returns the reply. The server layer is a thin shim:
 * validate parameters, default omitted optional fields, forward to the
 * dispatcher, return the dispatcher reply verbatim.
 *
 * The `dispatch` dependency is injected so the tools are unit-testable
 * without a live UDP transport; Phase 3 wires a real UDP client into the
 * same signature.
 */

import { ToolInputError } from '../project/errors.js';

/**
 * Generic dispatcher for the profiling family. The concrete transport
 * (UDP client in Phase 3) knows how to route `method` to the runtime
 * bridge and deserialize the JSON-RPC reply.
 */
export type ProfilingDispatcher = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface ProfilingDeps {
  dispatch?: ProfilingDispatcher;
}

export interface GetPerformanceMonitorsParams {
  /**
   * Optional filter of Godot `Performance` monitor names to sample.
   * When omitted or empty, the runtime bridge returns the full
   * baseline set (at minimum `fps`, `draw_calls`, `physics_frames`).
   */
  monitors?: string[];
}

export interface GetPerformanceMonitorsResult {
  monitors?: Record<string, number>;
  [key: string]: unknown;
}

export async function getPerformanceMonitors(
  params: GetPerformanceMonitorsParams,
  deps: ProfilingDeps,
): Promise<GetPerformanceMonitorsResult> {
  const dispatch = requireDispatcher(deps, 'profiling.get_performance_monitors');
  const monitors = params.monitors === undefined ? [] : params.monitors;
  requireMonitorsArray(monitors);

  const reply = await dispatch('profiling.get_performance_monitors', {
    monitors,
  });
  return reply as GetPerformanceMonitorsResult;
}

// ---------------------------------------------------------------------------
// profiling.get_frame_stats
// ---------------------------------------------------------------------------

/**
 * Default rolling window (frames) used when the caller does not specify
 * `window_frames`. At 60 fps this covers the last ~2 seconds of frame
 * time samples, which is long enough to reveal hitching without drowning
 * recent spikes in historical noise.
 */
export const DEFAULT_FRAME_STATS_WINDOW = 120;

export interface GetFrameStatsParams {
  /**
   * Size of the rolling window (number of most recent frames) to
   * summarize. Must be a positive integer. Defaults to
   * `DEFAULT_FRAME_STATS_WINDOW` when omitted.
   */
  window_frames?: number;
}

export interface FrameTimePercentilesMs {
  p50: number;
  p95: number;
  p99: number;
}

export interface GetFrameStatsResult {
  window_frames?: number;
  /** Actual number of samples available in the ring buffer (0..window_frames). */
  samples?: number;
  frame_time_ms?: FrameTimePercentilesMs;
  draw_calls?: number;
  [key: string]: unknown;
}

export async function getFrameStats(
  params: GetFrameStatsParams,
  deps: ProfilingDeps,
): Promise<GetFrameStatsResult> {
  const dispatch = requireDispatcher(deps, 'profiling.get_frame_stats');
  const windowFrames =
    params.window_frames === undefined
      ? DEFAULT_FRAME_STATS_WINDOW
      : params.window_frames;
  requirePositiveInteger(windowFrames, 'window_frames');

  const reply = await dispatch('profiling.get_frame_stats', {
    window_frames: windowFrames,
  });
  return reply as GetFrameStatsResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireDispatcher(
  deps: ProfilingDeps,
  toolName: string,
): ProfilingDispatcher {
  if (typeof deps.dispatch !== 'function') {
    throw new ToolInputError(
      `${toolName} requires a runtime dispatcher; the UDP transport is not connected.`,
    );
  }
  return deps.dispatch;
}

function requireMonitorsArray(value: unknown): asserts value is string[] {
  if (!Array.isArray(value)) {
    throw new ToolInputError(
      `"monitors" must be an array of strings (got ${JSON.stringify(value)}).`,
    );
  }
  for (const [i, entry] of value.entries()) {
    if (typeof entry !== 'string') {
      throw new ToolInputError(
        `"monitors[${i}]" must be a string (got ${typeof entry}).`,
      );
    }
    if (entry.length === 0) {
      throw new ToolInputError(
        `"monitors[${i}]" must be a non-empty string.`,
      );
    }
  }
}

function requirePositiveInteger(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(
      `"${field}" must be a finite positive integer (got ${JSON.stringify(value)}).`,
    );
  }
  if (!Number.isInteger(value)) {
    throw new ToolInputError(
      `"${field}" must be an integer (got ${value}).`,
    );
  }
  if (value < 1) {
    throw new ToolInputError(
      `"${field}" must be >= 1 (got ${value}).`,
    );
  }
}
