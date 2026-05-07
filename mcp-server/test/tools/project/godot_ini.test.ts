/**
 * Tests for the Godot INI-like parser used by project.get_settings /
 * project.update_settings. The format is close to classic INI but:
 *
 *   - Keys may contain '/' (e.g. `input/ui_accept/events`).
 *   - Values are Godot literals (strings, integers, floats, booleans,
 *     PackedStringArray(...), Dictionary({...}), etc.). The parser keeps
 *     values as raw strings because project.get_settings returns them
 *     verbatim, and update_settings round-trips them.
 *   - Section names include dots (e.g. `application`, `autoload`).
 *   - A leading comment block before the first section is preserved as
 *     the file preamble.
 *
 * The parser is deliberately non-destructive: parse → modify → serialize
 * preserves section order, key order inside sections, blank lines between
 * sections, and the preamble. This is what lets project.update_settings
 * merge a single key without touching anything else.
 */

import { describe, expect, it } from 'vitest';

import {
  parseGodotIni,
  serializeGodotIni,
  type GodotIni,
} from '../../../src/tools/project/godot_ini.js';

const SAMPLE = `; Engine configuration file.
; Second preamble line.

config_version=5

[application]

config/name="ForgeKit Core Template"
config/features=PackedStringArray("4.3", "Forward Plus")

[autoload]

GameEvents="*res://addons/forgekit_core/event_bus/game_events.gd"
`;

describe('parseGodotIni', () => {
  it('captures the preamble comment block verbatim', () => {
    const ini = parseGodotIni(SAMPLE);
    expect(ini.preamble).toBe(
      '; Engine configuration file.\n; Second preamble line.\n\nconfig_version=5\n\n',
    );
  });

  it('returns sections in file order', () => {
    const ini = parseGodotIni(SAMPLE);
    expect(ini.sections.map((s) => s.name)).toEqual(['application', 'autoload']);
  });

  it('preserves key order within a section', () => {
    const ini = parseGodotIni(SAMPLE);
    const application = ini.sections.find((s) => s.name === 'application');
    expect(application?.keys.map((k) => k.key)).toEqual([
      'config/name',
      'config/features',
    ]);
  });

  it('keeps values as raw strings (no literal coercion)', () => {
    const ini = parseGodotIni(SAMPLE);
    const application = ini.sections.find((s) => s.name === 'application');
    expect(application?.keys[0].value).toBe('"ForgeKit Core Template"');
    expect(application?.keys[1].value).toBe(
      'PackedStringArray("4.3", "Forward Plus")',
    );
  });

  it('rejects duplicate keys within the same section', () => {
    const input = '[application]\n\nconfig/name="A"\nconfig/name="B"\n';
    expect(() => parseGodotIni(input)).toThrow(/duplicate key/);
  });

  it('rejects a section declared twice', () => {
    const input = '[a]\n\nkey=1\n\n[a]\n\nother=2\n';
    expect(() => parseGodotIni(input)).toThrow(/duplicate section/);
  });

  it('rejects a line that is neither a comment, blank, section, nor key=value', () => {
    const input = '[application]\n\nnot a valid line\n';
    expect(() => parseGodotIni(input)).toThrow(/malformed line/);
  });
});

describe('serializeGodotIni', () => {
  it('round-trips the sample exactly', () => {
    const ini = parseGodotIni(SAMPLE);
    expect(serializeGodotIni(ini)).toBe(SAMPLE);
  });

  it('writes sections in the order they were stored', () => {
    const ini: GodotIni = {
      preamble: '',
      sections: [
        {
          name: 'z',
          keys: [{ key: 'k', value: '1' }],
          trailingBlankLines: 1,
        },
        {
          name: 'a',
          keys: [{ key: 'k', value: '2' }],
          trailingBlankLines: 1,
        },
      ],
    };
    expect(serializeGodotIni(ini)).toBe('[z]\n\nk=1\n\n[a]\n\nk=2\n\n');
  });
});

describe('getSettingsByPrefix', () => {
  it('returns only settings under the requested section when given a prefix', async () => {
    // This smoke test forces getSettingsFlat to exist before
    // project.get_settings depends on it.
    const { flattenSettings } = await import(
      '../../../src/tools/project/godot_ini.js'
    );
    const ini = parseGodotIni(SAMPLE);
    const all = flattenSettings(ini);
    expect(all['application/config/name']).toBe('"ForgeKit Core Template"');
    expect(all['autoload/GameEvents']).toBe(
      '"*res://addons/forgekit_core/event_bus/game_events.gd"',
    );
  });
});
