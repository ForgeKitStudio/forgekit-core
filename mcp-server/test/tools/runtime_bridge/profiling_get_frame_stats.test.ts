/**
 * Tests for the `profiling.get_frame_stats` MCP tool.
 *
 * The tool targets the runtime channel: the MCP server validates the
 * optional `window_frames` argument, forwards the call to an injected
 * dispatcher that talks to the MCP Runtime Bridge (UDP), and returns the
 * bridge's reply verbatim. The runtime bridge maintains a per-frame
 * sample ring buffer, computes p50/p95/p99 over the most recent
 * `window_frames` entries, and returns the current `draw_calls` alongside
 * the actual number of buffered samples.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  getFrameStats,
  type ProfilingDispatcher,
} from '../../../src/tools/runtime_bridge/profiling.js';
import { ToolInputError } from '../../../src/tools/project/errors.js';

describe('getFrameStats', () => {
  it('defaults `window_frames` to 120 when omitted and returns the dispatcher reply', async () => {
    const dispatch: ProfilingDispatcher = vi.fn().mockResolvedValue({
      window_frames: 120,
      samples: 120,
      frame_time_ms: { p50: 16.5, p95: 19.0, p99: 22.0 },
      draw_calls: 742,
    });
    const result = await getFrameStats({}, { dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('profiling.get_frame_stats', {
      window_frames: 120,
    });
    expect(result).toEqual({
      window_frames: 120,
      samples: 120,
      frame_time_ms: { p50: 16.5, p95: 19.0, p99: 22.0 },
      draw_calls: 742,
    });
  });

  it('forwards an explicit `window_frames` value verbatim', async () => {
    const dispatch: ProfilingDispatcher = vi.fn().mockResolvedValue({});
    await getFrameStats({ window_frames: 60 }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('profiling.get_frame_stats', {
      window_frames: 60,
    });
  });

  it('accepts `window_frames === 1` as the minimum valid value', async () => {
    const dispatch: ProfilingDispatcher = vi.fn().mockResolvedValue({});
    await getFrameStats({ window_frames: 1 }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('profiling.get_frame_stats', {
      window_frames: 1,
    });
  });

  it('rejects `window_frames === 0`', async () => {
    const dispatch: ProfilingDispatcher = vi.fn();
    await expect(
      getFrameStats({ window_frames: 0 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects negative `window_frames`', async () => {
    const dispatch: ProfilingDispatcher = vi.fn();
    await expect(
      getFrameStats({ window_frames: -1 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects non-integer `window_frames`', async () => {
    const dispatch: ProfilingDispatcher = vi.fn();
    await expect(
      getFrameStats({ window_frames: 1.5 }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-number `window_frames`', async () => {
    const dispatch: ProfilingDispatcher = vi.fn();
    await expect(
      getFrameStats(
        { window_frames: '120' as unknown as number },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects NaN or Infinity `window_frames`', async () => {
    const dispatch: ProfilingDispatcher = vi.fn();
    await expect(
      getFrameStats({ window_frames: Number.NaN }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    await expect(
      getFrameStats({ window_frames: Number.POSITIVE_INFINITY }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      getFrameStats({}, {} as { dispatch?: ProfilingDispatcher }),
    ).rejects.toThrow(ToolInputError);
  });
});
