/**
 * Tests for the `android.install_apk` MCP tool.
 *
 * The tool spawns `adb install <apk>` (or `adb -s <serial> install <apk>`
 * when a device_serial is supplied) and surfaces the outcome.
 */

import { describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/testing/errors.js';
import { installApk } from '../../../src/tools/android/install_apk.js';
import type { SpawnAdb } from '../../../src/tools/android/spawn_adb.js';

function fakeAdb(opts: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  calls?: { args: readonly string[] }[];
} = {}): SpawnAdb {
  return async (args) => {
    opts.calls?.push({ args: [...args] });
    return {
      stdout: opts.stdout ?? 'Success\n',
      stderr: opts.stderr ?? '',
      exitCode: opts.exitCode ?? 0,
    };
  };
}

describe('installApk', () => {
  it('spawns `adb install <apk>` when no device_serial is provided', async () => {
    const calls: { args: readonly string[] }[] = [];
    const result = await installApk(
      { apk_path: 'dist/game.apk' },
      { spawn: fakeAdb({ calls }) },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['install', 'dist/game.apk']);
    expect(result.installed).toBe(true);
  });

  it('targets the requested device via -s <serial>', async () => {
    const calls: { args: readonly string[] }[] = [];
    await installApk(
      { apk_path: 'dist/game.apk', device_serial: 'RZ8NA0XXXX' },
      { spawn: fakeAdb({ calls }) },
    );
    expect(calls[0].args).toEqual([
      '-s',
      'RZ8NA0XXXX',
      'install',
      'dist/game.apk',
    ]);
  });

  it('returns installed=false when adb exits non-zero', async () => {
    const result = await installApk(
      { apk_path: 'dist/game.apk' },
      { spawn: fakeAdb({ exitCode: 1, stderr: 'install failed' }) },
    );
    expect(result.installed).toBe(false);
    expect(result.output).toContain('install failed');
  });

  it('rejects an empty apk_path', async () => {
    await expect(
      installApk({ apk_path: '' }, { spawn: fakeAdb() }),
    ).rejects.toThrow(ToolInputError);
  });
});
