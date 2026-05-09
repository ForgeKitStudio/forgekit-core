/**
 * Tests for the `export.validate_preset` MCP tool.
 *
 * The tool reads `export_presets.cfg`, locates the named preset, and
 * verifies that `name`, `platform`, and `export_path` are present and
 * non-empty. Missing fields are surfaced as `{field, reason}` entries in
 * the returned `errors` array.
 */

import { describe, expect, it } from 'vitest';

import { validatePreset } from '../../../src/tools/export/validate_preset.js';

describe('validatePreset', () => {
  it('returns valid=true when the preset has all required fields', async () => {
    const cfg = `[preset.0]\nname="Win"\nplatform="Windows Desktop"\nrunnable=true\nexport_path="dist/g.exe"\n`;
    const result = await validatePreset(
      { preset_name: 'Win' },
      { readFile: async () => cfg },
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns valid=false and lists missing export_path', async () => {
    const cfg = `[preset.0]\nname="Win"\nplatform="Windows Desktop"\nrunnable=true\nexport_path=""\n`;
    const result = await validatePreset(
      { preset_name: 'Win' },
      { readFile: async () => cfg },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'export_path')).toBe(true);
  });

  it('returns valid=false when the preset is not found', async () => {
    const cfg = `[preset.0]\nname="Win"\nplatform="Windows Desktop"\nrunnable=true\nexport_path="dist/g.exe"\n`;
    const result = await validatePreset(
      { preset_name: 'Linux' },
      { readFile: async () => cfg },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.reason.includes('not found'))).toBe(
      true,
    );
  });
});
