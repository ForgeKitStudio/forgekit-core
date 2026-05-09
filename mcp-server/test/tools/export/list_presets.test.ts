/**
 * Tests for the `export.list_presets` MCP tool.
 *
 * The tool reads `export_presets.cfg` from the project root and returns the
 * list of defined presets with their `name`, `platform`, `runnable`, and
 * `export_path` fields. Tests inject a fake reader so they never touch the
 * filesystem.
 */

import { describe, expect, it } from 'vitest';

import {
  ExportPresetsFileMissingError,
  listPresets,
} from '../../../src/tools/export/list_presets.js';

describe('listPresets — happy path', () => {
  it('parses a single preset with all canonical fields', async () => {
    const cfg = `[preset.0]\nname="Windows Desktop"\nplatform="Windows Desktop"\nrunnable=true\nexport_path="dist/game.exe"\n`;
    const result = await listPresets({}, { readFile: async () => cfg });
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0]).toMatchObject({
      name: 'Windows Desktop',
      platform: 'Windows Desktop',
      runnable: true,
      export_path: 'dist/game.exe',
    });
  });

  it('parses multiple presets in preset.<index> order', async () => {
    const cfg = `[preset.0]\nname="Win"\nplatform="Windows Desktop"\nrunnable=true\nexport_path="dist/w.exe"\n\n[preset.1]\nname="Linux"\nplatform="Linux/X11"\nrunnable=false\nexport_path="dist/l.x86_64"\n`;
    const result = await listPresets({}, { readFile: async () => cfg });
    expect(result.presets).toHaveLength(2);
    expect(result.presets[0].name).toBe('Win');
    expect(result.presets[1].name).toBe('Linux');
    expect(result.presets[1].runnable).toBe(false);
  });

  it('returns an empty array when no presets are defined', async () => {
    const result = await listPresets({}, { readFile: async () => '' });
    expect(result.presets).toEqual([]);
  });
});

describe('listPresets — error handling', () => {
  it('throws ExportPresetsFileMissingError when the file is absent', async () => {
    const reader = async () => {
      const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    };
    await expect(listPresets({}, { readFile: reader })).rejects.toThrow(
      ExportPresetsFileMissingError,
    );
  });
});
