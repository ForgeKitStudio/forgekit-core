/**
 * Minimal parser for Godot's `export_presets.cfg` file.
 *
 * The file follows a ConfigFile INI dialect with sections like
 * `[preset.0]`, `[preset.0.options]`, and quoted string values. We only
 * need the top-level preset fields (`name`, `platform`, `runnable`,
 * `export_path`) for the three export tools, so this parser is intentionally
 * narrow: it splits by section headers and extracts the four keys per
 * `preset.<index>` section.
 */

export interface ExportPreset {
  name: string;
  platform: string;
  runnable: boolean;
  export_path: string;
}

/**
 * Parse the raw `export_presets.cfg` contents into a list of presets
 * ordered by their `preset.<index>` section. Returns an empty array when
 * no presets are defined.
 */
export function parseExportPresets(cfg: string): ExportPreset[] {
  const lines = cfg.split(/\r?\n/);
  const presets: ExportPreset[] = [];
  let current: Partial<ExportPreset> | null = null;
  let inTopLevelPreset = false;

  for (const raw of lines) {
    const line = raw.trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch !== null) {
      if (current !== null && inTopLevelPreset) {
        presets.push(normalize(current));
      }
      const section = sectionMatch[1];
      // Only top-level preset.<index> sections contain the fields we need.
      // Nested sections like `preset.0.options` are ignored.
      if (/^preset\.\d+$/.test(section)) {
        current = {};
        inTopLevelPreset = true;
      } else {
        current = null;
        inTopLevelPreset = false;
      }
      continue;
    }

    if (current === null || !inTopLevelPreset) continue;
    if (line === '' || line.startsWith(';')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    switch (key) {
      case 'name':
        current.name = stripQuotes(value);
        break;
      case 'platform':
        current.platform = stripQuotes(value);
        break;
      case 'runnable':
        current.runnable = value === 'true';
        break;
      case 'export_path':
        current.export_path = stripQuotes(value);
        break;
      default:
        break;
    }
  }

  if (current !== null && inTopLevelPreset) {
    presets.push(normalize(current));
  }

  return presets;
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function normalize(raw: Partial<ExportPreset>): ExportPreset {
  return {
    name: raw.name ?? '',
    platform: raw.platform ?? '',
    runnable: raw.runnable ?? false,
    export_path: raw.export_path ?? '',
  };
}
