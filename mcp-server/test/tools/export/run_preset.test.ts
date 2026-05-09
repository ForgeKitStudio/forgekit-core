/**
 * Tests for the `export.run_preset` MCP tool.
 *
 * The tool spawns `godot --headless --export-release <preset>` (or
 * `--export-debug` when `debug=true`) and captures the stdout/stderr to a
 * log file. A fake spawn is injected so tests never touch the filesystem or
 * invoke Godot.
 */

import { describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/testing/errors.js';
import { runPreset } from '../../../src/tools/export/run_preset.js';
import type { SpawnGodot } from '../../../src/tools/testing/spawn_godot.js';

function fakeSpawn(opts: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  calls?: { args: readonly string[] }[];
} = {}): SpawnGodot {
  return async (args) => {
    opts.calls?.push({ args: [...args] });
    return {
      stdout: opts.stdout ?? '',
      stderr: opts.stderr ?? '',
      exitCode: opts.exitCode ?? 0,
    };
  };
}

describe('runPreset — happy path', () => {
  it('spawns godot --headless --export-release by default', async () => {
    const calls: { args: readonly string[] }[] = [];
    const writeFile = async () => {};
    const result = await runPreset(
      { preset_name: 'Windows Desktop', output_path: 'dist/game.exe' },
      { spawn: fakeSpawn({ calls }), writeFile },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('--headless');
    expect(calls[0].args).toContain('--export-release');
    expect(calls[0].args).toContain('Windows Desktop');
    expect(calls[0].args).toContain('dist/game.exe');
    expect(result.success).toBe(true);
  });

  it('switches to --export-debug when debug=true', async () => {
    const calls: { args: readonly string[] }[] = [];
    const writeFile = async () => {};
    await runPreset(
      { preset_name: 'Windows Desktop', output_path: 'dist/game.exe', debug: true },
      { spawn: fakeSpawn({ calls }), writeFile },
    );
    expect(calls[0].args).toContain('--export-debug');
    expect(calls[0].args).not.toContain('--export-release');
  });

  it('returns artifact_path equal to output_path on success', async () => {
    const writeFile = async () => {};
    const result = await runPreset(
      { preset_name: 'W', output_path: 'dist/g.exe' },
      { spawn: fakeSpawn({ exitCode: 0 }), writeFile },
    );
    expect(result.artifact_path).toBe('dist/g.exe');
    expect(result.log_path).toMatch(/\.log$/);
  });
});

describe('runPreset — failure handling', () => {
  it('returns success=false when godot exits non-zero', async () => {
    const writeFile = async () => {};
    const result = await runPreset(
      { preset_name: 'W', output_path: 'dist/g.exe' },
      {
        spawn: fakeSpawn({ exitCode: 1, stderr: 'export failed' }),
        writeFile,
      },
    );
    expect(result.success).toBe(false);
  });
});

describe('runPreset — input validation', () => {
  it('rejects an empty preset_name', async () => {
    await expect(
      runPreset(
        { preset_name: '', output_path: 'dist/g.exe' },
        { spawn: fakeSpawn(), writeFile: async () => {} },
      ),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty output_path', async () => {
    await expect(
      runPreset(
        { preset_name: 'W', output_path: '' },
        { spawn: fakeSpawn(), writeFile: async () => {} },
      ),
    ).rejects.toThrow(ToolInputError);
  });
});
