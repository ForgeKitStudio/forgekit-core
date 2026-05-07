/**
 * Non-destructive parser / serializer for `project.godot` and similar
 * Godot INI-like files. Preserves section order, key order, blank lines
 * between sections, and the preamble so a parse → modify → serialize
 * round-trip is byte-exact when no keys are changed.
 *
 * Values are kept as raw strings (the text to the right of `=`). Godot
 * literals such as `PackedStringArray("4.3", "Forward Plus")` or
 * `Dictionary({ ... })` are not coerced — the caller owns interpretation.
 * This is exactly what `project.get_settings` needs: it returns values
 * verbatim, and `project.update_settings` passes raw literal strings
 * through without translating them.
 */

export interface GodotIniKey {
  key: string;
  value: string;
}

export interface GodotIniSection {
  name: string;
  keys: GodotIniKey[];
  /** Blank lines after the last key of this section (before next section). */
  trailingBlankLines: number;
}

export interface GodotIni {
  /**
   * Everything before the first `[section]` header, preserved byte-exact.
   * For `project.godot` this typically includes the `; Engine configuration`
   * comment and the `config_version=5` line.
   */
  preamble: string;
  sections: GodotIniSection[];
}

const SECTION_RE = /^\[([^\]]+)\]\s*$/;
// Key = anything up to the first `=`, then the remainder verbatim.
// Godot keys include `/` (e.g. `input/ui_accept/events`). The key must
// match `[A-Za-z_][\w/]*` to avoid catching lines that only look like
// values.
const KEY_RE = /^([A-Za-z_][\w/.-]*)=(.*)$/;

export function parseGodotIni(source: string): GodotIni {
  const lines = source.split('\n');
  const preambleLines: string[] = [];
  const sections: GodotIniSection[] = [];
  const sectionNames = new Set<string>();

  let current: GodotIniSection | null = null;
  let trailingBlankLines = 0;
  let inPreamble = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip the trailing "" from a final newline.
    const isFinalEmpty = i === lines.length - 1 && line === '';
    if (isFinalEmpty) break;

    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      const name = sectionMatch[1];
      if (sectionNames.has(name)) {
        throw new Error(`duplicate section "[${name}]"`);
      }
      sectionNames.add(name);
      if (current !== null) {
        current.trailingBlankLines = trailingBlankLines;
      }
      current = { name, keys: [], trailingBlankLines: 0 };
      sections.push(current);
      trailingBlankLines = 0;
      inPreamble = false;
      continue;
    }

    if (inPreamble) {
      preambleLines.push(line);
      continue;
    }

    // Blank line or comment inside a section: track trailing blanks.
    if (line.trim() === '') {
      trailingBlankLines++;
      continue;
    }
    if (line.startsWith(';') || line.startsWith('#')) {
      // Comments inside sections are rare in project.godot and not
      // preserved here. The caller can reintroduce them via preamble or
      // by editing the file directly.
      trailingBlankLines = 0;
      continue;
    }

    const keyMatch = KEY_RE.exec(line);
    if (!keyMatch) {
      throw new Error(`malformed line ${i + 1}: ${JSON.stringify(line)}`);
    }
    const [, key, value] = keyMatch;
    if (current === null) {
      // Unreachable: inPreamble would be true.
      throw new Error(`key "${key}" appears before any section`);
    }
    if (current.keys.some((k) => k.key === key)) {
      throw new Error(`duplicate key "${key}" in [${current.name}]`);
    }
    // Reset blank-line counter because we're still inside this section.
    trailingBlankLines = 0;
    current.keys.push({ key, value });
  }

  if (current !== null) {
    current.trailingBlankLines = trailingBlankLines;
  }

  return {
    preamble: preambleLines.length > 0 ? preambleLines.join('\n') + '\n' : '',
    sections,
  };
}

export function serializeGodotIni(ini: GodotIni): string {
  let out = ini.preamble;
  for (const section of ini.sections) {
    out += `[${section.name}]\n\n`;
    for (const { key, value } of section.keys) {
      out += `${key}=${value}\n`;
    }
    for (let i = 0; i < section.trailingBlankLines; i++) {
      out += '\n';
    }
  }
  return out;
}

/**
 * Returns a flat `{"<section>/<key>": "<raw value>"}` map. Used by
 * `project.get_settings` to serve a section filter without rebuilding the
 * INI tree on every call.
 */
export function flattenSettings(ini: GodotIni): Record<string, string> {
  const out: Record<string, string> = {};
  for (const section of ini.sections) {
    for (const { key, value } of section.keys) {
      out[`${section.name}/${key}`] = value;
    }
  }
  return out;
}
