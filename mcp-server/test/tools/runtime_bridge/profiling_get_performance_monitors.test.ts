/**
 * Tests for the `profiling.get_performance_monitors` MCP tool.
 *
 * The tool targets the runtime channel: the MCP server validates the
 * optional `monitors` filter, forwards the call to an injected dispatcher
 * that talks to the MCP Runtime Bridge (UDP), and returns the bridge's
 * reply verbatim. The runtime bridge samples the requested monitors via
 * the Godot `Performance` singleton and returns a `{monitors: {...}}`
 * dictionary mapping monitor names to numeric samples.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  getPerformanceMonitors,
  type ProfilingDispatcher,
} from '../../../src/tools/runtime_bridge/profiling.js';
import { ToolInputError } from '../../../src/tools/project/errors.js';

describe('getPerformanceMonitors', () => {
  it('forwards no filter when `monitors` is omitted and returns the dispatcher reply', async () => {
    const dispatch: ProfilingDispatcher = vi.fn().mockResolvedValue({
      monitors: { fps: 60.0, draw_calls: 128.0, physics_frames: 60.0 },
    });
    const result = await getPerformanceMonitors({}, { dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('profiling.get_performance_monitors', {
      monitors: [],
    });
    expect(result).toEqual({
      monitors: { fps: 60.0, draw_calls: 128.0, physics_frames: 60.0 },
    });
  });

  it('forwards the `monitors` filter verbatim when provided', async () => {
    const dispatch: ProfilingDispatcher = vi.fn().mockResolvedValue({
      monitors: { fps: 59.5 },
    });
    await getPerformanceMonitors({ monitors: ['fps'] }, { dispatch });
    expect(dispatch).toHaveBeenCalledWith('profiling.get_performance_monitors', {
      monitors: ['fps'],
    });
  });

  it('preserves the order of monitor names in the filter', async () => {
    const dispatch: ProfilingDispatcher = vi.fn().mockResolvedValue({
      monitors: {},
    });
    await getPerformanceMonitors(
      { monitors: ['draw_calls', 'fps', 'physics_frames'] },
      { dispatch },
    );
    expect(dispatch).toHaveBeenCalledWith('profiling.get_performance_monitors', {
      monitors: ['draw_calls', 'fps', 'physics_frames'],
    });
  });

  it('rejects a non-array `monitors` value', async () => {
    const dispatch: ProfilingDispatcher = vi.fn();
    await expect(
      getPerformanceMonitors(
        { monitors: 'fps' as unknown as string[] },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a `monitors` entry that is not a string', async () => {
    const dispatch: ProfilingDispatcher = vi.fn();
    await expect(
      getPerformanceMonitors(
        { monitors: ['fps', 7 as unknown as string] },
        { dispatch },
      ),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects an empty-string `monitors` entry', async () => {
    const dispatch: ProfilingDispatcher = vi.fn();
    await expect(
      getPerformanceMonitors({ monitors: ['fps', ''] }, { dispatch }),
    ).rejects.toThrow(ToolInputError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('raises ToolInputError when the dispatcher is missing', async () => {
    await expect(
      getPerformanceMonitors({}, {} as { dispatch?: ProfilingDispatcher }),
    ).rejects.toThrow(ToolInputError);
  });
});
