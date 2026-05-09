/**
 * Tests for the `android.run_logcat` MCP tool.
 *
 * The tool spawns `adb logcat` for a bounded duration, optionally with a
 * filter expression, and returns the captured lines.
 */

import { describe, expect, it } from 'vitest';

import { runLogcat } from '../../../src/tools/android/run_logcat.js';
import type { SpawnAdb } from '../../../src/tools/android/spawn_adb.js';

function fakeAdb(
  stdout: string,
  opts: { calls?: { args: readonly string[] }[]; exitCode?: number } = {},
): SpawnAdb {
  return async (args) => {
    opts.calls?.push({ args: [...args] });
    return { stdout, stderr: '', exitCode: opts.exitCode ?? 0 };
  };
}

const SAMPLE = `12-24 10:00:00.000  1234  1234 I godot   : Line one\n12-24 10:00:01.000  1234  1234 W godot   : Line two\n`;

describe('runLogcat', () => {
  it('splits stdout into log_lines by newline', async () => {
    const result = await runLogcat({}, { spawn: fakeAdb(SAMPLE) });
    expect(result.log_lines).toHaveLength(2);
    expect(result.log_lines[0]).toContain('Line one');
    expect(result.log_lines[1]).toContain('Line two');
  });

  it('forwards the filter expression to adb logcat', async () => {
    const calls: { args: readonly string[] }[] = [];
    await runLogcat(
      { filter: 'godot:I *:S' },
      { spawn: fakeAdb(SAMPLE, { calls }) },
    );
    expect(calls[0].args).toContain('logcat');
    expect(calls[0].args).toContain('godot:I *:S');
  });

  it('returns an empty array when stdout is empty', async () => {
    const result = await runLogcat({}, { spawn: fakeAdb('') });
    expect(result.log_lines).toEqual([]);
  });
});
