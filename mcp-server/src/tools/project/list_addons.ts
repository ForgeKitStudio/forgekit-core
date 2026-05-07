/**
 * Implementation of the `project.list_addons` MCP tool.
 *
 * Enumerates every directory under `<projectRoot>/addons/` that ships
 * a `plugin.cfg`, returning `{id, enabled, path}` for each. The
 * `enabled` flag is derived from `project.godot [editor_plugins]
 * enabled=PackedStringArray(...)` — Godot records enabled EditorPlugin
 * instances there. Addons that are installed but not listed are
 * "disabled": they're on disk but Godot is not loading their
 * `plugin.gd` at editor start.
 *
 * Vendored helper directories without a `plugin.cfg` are ignored —
 * Godot also ignores them when building the "Plugins" editor list.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { ToolInputError } from './errors.js';
import { parseGodotIni } from './godot_ini.js';

export interface ListAddonsParams {
  projectRoot: string;
}

export interface ListedAddon {
  id: string;
  enabled: boolean;
  path: string;
}

export interface ListAddonsResult {
  addons: ListedAddon[];
}

export async function listAddons(
  params: ListAddonsParams,
): Promise<ListAddonsResult> {
  if (
    typeof params.projectRoot !== 'string' ||
    params.projectRoot.trim() === ''
  ) {
    throw new ToolInputError(
      `"projectRoot" must be a non-empty string (got ${JSON.stringify(params.projectRoot)}).`,
    );
  }

  const addonsDir = join(params.projectRoot, 'addons');
  let entries: string[];
  try {
    entries = await readdir(addonsDir);
  } catch {
    return { addons: [] };
  }
  entries.sort();

  const enabledPaths = await readEnabledPlugins(params.projectRoot);

  const addons: ListedAddon[] = [];
  for (const name of entries) {
    const dir = join(addonsDir, name);
    let isDir = false;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const pluginCfg = join(dir, 'plugin.cfg');
    try {
      await stat(pluginCfg);
    } catch {
      // No plugin.cfg → Godot wouldn't surface this, so we skip too.
      continue;
    }

    const pluginCfgUri = `res://addons/${name}/plugin.cfg`;
    addons.push({
      id: name,
      enabled: enabledPaths.has(pluginCfgUri),
      path: `res://addons/${name}`,
    });
  }
  return { addons };
}

/**
 * Parses `project.godot [editor_plugins] enabled=PackedStringArray(...)`
 * into a set of `res://addons/<dir>/plugin.cfg` URIs. Returns an empty
 * set when the file or section is missing.
 */
async function readEnabledPlugins(projectRoot: string): Promise<Set<string>> {
  const projectGodot = join(projectRoot, 'project.godot');
  let text: string;
  try {
    text = await readFile(projectGodot, 'utf8');
  } catch {
    return new Set();
  }

  let ini;
  try {
    ini = parseGodotIni(text);
  } catch {
    return new Set();
  }

  const section = ini.sections.find((s) => s.name === 'editor_plugins');
  if (section === undefined) return new Set();
  const entry = section.keys.find((k) => k.key === 'enabled');
  if (entry === undefined) return new Set();

  const paths = extractPackedStringArray(entry.value);
  return new Set(paths);
}

/**
 * Returns the string literals inside `PackedStringArray("a", "b")` or
 * `[String, String]` textual forms. Non-matching input yields `[]`.
 */
function extractPackedStringArray(raw: string): string[] {
  const open = raw.indexOf('(');
  const close = raw.lastIndexOf(')');
  if (open !== -1 && close > open) {
    return matchQuoted(raw.slice(open + 1, close));
  }
  const openB = raw.indexOf('[');
  const closeB = raw.lastIndexOf(']');
  if (openB !== -1 && closeB > openB) {
    return matchQuoted(raw.slice(openB + 1, closeB));
  }
  return [];
}

function matchQuoted(body: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]*)"/g;
  for (const m of body.matchAll(pattern)) {
    out.push(m[1]);
  }
  return out;
}
