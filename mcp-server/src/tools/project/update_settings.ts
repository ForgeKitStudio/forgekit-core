/**
 * Implementation of the `project.update_settings` MCP tool.
 *
 * Applies a `<section>/<key> = <raw literal>` patch to `project.godot`
 * atomically, merging per-key so that no unrelated setting is ever
 * overwritten. This is the fix for the `events`-overwrite bug that
 * plagues naive `update_project_settings` implementations: we read
 * from disk, parse the full INI tree, mutate only the keys named in
 * `patch`, serialize, and atomically rename the temp file over the
 * original.
 *
 * Values in `patch` are raw strings — the caller must pre-serialize
 * any Godot literals (e.g. strings wrapped in quotes, PackedStringArray,
 * Dictionary bodies). The tool returns both the applied diff and the
 * previous values so the Undo wrapper on the Godot side can produce a
 * reversible action.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { atomicWriteFile } from './atomic_writer.js';
import { enforceBoundary } from './core_boundary.js';
import { ProjectIoError, ToolInputError } from './errors.js';
import {
  parseGodotIni,
  serializeGodotIni,
  type GodotIni,
  type GodotIniSection,
} from './godot_ini.js';

export interface UpdateSettingsParams {
  projectRoot: string;
  /**
   * `{ "<section>/<key>": "<raw Godot literal>" }`. Values are assigned
   * verbatim — callers wrap strings in quotes, stringify dictionaries,
   * etc. before invoking this tool.
   */
  patch: Record<string, string>;
}

export interface UpdateSettingsResult {
  /** Keys that actually changed, mapped to their new values. */
  applied: Record<string, string>;
  /** Previous values per changed key, or null when the key did not exist. */
  previous: Record<string, string | null>;
}

export async function updateSettings(
  params: UpdateSettingsParams,
): Promise<UpdateSettingsResult> {
  validateParams(params);

  const projectGodot = join(params.projectRoot, 'project.godot');
  // Reject the write before any disk I/O when `project.godot` would
  // land inside the Core Boundary (e.g. a caller pointing
  // `projectRoot` at `addons/forgekit_core/`).
  enforceBoundary(projectGodot);
  let source: string;
  try {
    source = await readFile(projectGodot, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ProjectIoError(`Unable to read ${projectGodot}: ${reason}`);
  }

  const ini = parseGodotIni(source);
  const applied: Record<string, string> = {};
  const previous: Record<string, string | null> = {};

  for (const [dottedKey, newValue] of Object.entries(params.patch)) {
    const sectionName = dottedKey.slice(0, dottedKey.indexOf('/'));
    const localKey = dottedKey.slice(dottedKey.indexOf('/') + 1);

    const { prev, changed } = applyPatch(ini, sectionName, localKey, newValue);
    if (changed) {
      applied[dottedKey] = newValue;
      previous[dottedKey] = prev;
    }
  }

  if (Object.keys(applied).length === 0) {
    return { applied, previous };
  }

  await atomicWriteFile(projectGodot, serializeGodotIni(ini));
  return { applied, previous };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateParams(params: UpdateSettingsParams): void {
  if (
    typeof params.projectRoot !== 'string' ||
    params.projectRoot.trim() === ''
  ) {
    throw new ToolInputError(
      `"projectRoot" must be a non-empty string (got ${JSON.stringify(params.projectRoot)}).`,
    );
  }
  if (
    params.patch === null ||
    typeof params.patch !== 'object' ||
    Array.isArray(params.patch)
  ) {
    throw new ToolInputError(
      `"patch" must be an object mapping "<section>/<key>" to raw literal strings.`,
    );
  }
  const entries = Object.entries(params.patch);
  if (entries.length === 0) {
    throw new ToolInputError('"patch" must not be empty.');
  }
  for (const [key, value] of entries) {
    if (!key.includes('/')) {
      throw new ToolInputError(
        `"patch" key ${JSON.stringify(key)} must be of the form "<section>/<key>".`,
      );
    }
    if (key.startsWith('/')) {
      throw new ToolInputError(
        `"patch" key ${JSON.stringify(key)} must name a section before the first "/".`,
      );
    }
    if (typeof value !== 'string') {
      throw new ToolInputError(
        `"patch" value for ${JSON.stringify(key)} must be a string (got ${typeof value}).`,
      );
    }
  }
}

function applyPatch(
  ini: GodotIni,
  sectionName: string,
  localKey: string,
  newValue: string,
): { prev: string | null; changed: boolean } {
  let section = ini.sections.find((s) => s.name === sectionName);
  if (section === undefined) {
    section = appendSection(ini, sectionName);
  }
  const existing = section.keys.find((k) => k.key === localKey);
  if (existing === undefined) {
    section.keys.push({ key: localKey, value: newValue });
    // A brand-new key makes the section "dirty"; ensure a trailing blank
    // line separates it from the next section.
    if (section.trailingBlankLines === 0) section.trailingBlankLines = 1;
    return { prev: null, changed: true };
  }
  if (existing.value === newValue) {
    return { prev: existing.value, changed: false };
  }
  const prev = existing.value;
  existing.value = newValue;
  return { prev, changed: true };
}

function appendSection(ini: GodotIni, name: string): GodotIniSection {
  // Give the previous section a visible blank-line gap before the new
  // header, matching the idiomatic `project.godot` layout.
  if (ini.sections.length > 0) {
    const last = ini.sections[ini.sections.length - 1];
    if (last.trailingBlankLines === 0) last.trailingBlankLines = 1;
  }
  const created: GodotIniSection = {
    name,
    keys: [],
    trailingBlankLines: 1,
  };
  ini.sections.push(created);
  return created;
}
