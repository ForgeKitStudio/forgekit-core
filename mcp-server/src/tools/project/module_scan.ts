/**
 * Scans the `addons/` directory of a Godot project for ForgeKit modules.
 *
 * A ForgeKit module is a directory named `forgekit_<id>` (other than
 * `forgekit_core`, which is the foundation, not a module) that contains
 * a `module.manifest.tres` file. The server-side scanner mirrors the
 * GDScript `ModuleLoader.scan` behavior: placeholder directories
 * (e.g. a freshly-cloned template with only `.gitkeep`) are silently
 * ignored, so the scanner never reports spurious modules for unbuilt
 * projects.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const MODULE_PREFIX = 'forgekit_';
const CORE_DIR = 'forgekit_core';
const MANIFEST_FILE = 'module.manifest.tres';

export interface ModuleManifest {
  id: string;
  version: string;
  core_min_version: string;
  depends_on: string[];
  license_id: string;
  source_repo: string;
}

export interface DiscoveredModule {
  manifestPath: string;
  moduleDir: string;
  manifest: ModuleManifest;
}

/**
 * Returns every `forgekit_*` module directory under `<projectRoot>/addons/`
 * that has a `module.manifest.tres` file. The results are sorted by
 * directory name for deterministic output.
 */
export async function scanModules(
  projectRoot: string,
): Promise<DiscoveredModule[]> {
  const addonsDir = join(projectRoot, 'addons');
  let entries: string[];
  try {
    entries = await readdir(addonsDir);
  } catch {
    return [];
  }

  const results: DiscoveredModule[] = [];
  entries.sort();
  for (const name of entries) {
    if (!name.startsWith(MODULE_PREFIX) || name === CORE_DIR) {
      continue;
    }
    const moduleDir = join(addonsDir, name);
    let isDir = false;
    try {
      const s = await stat(moduleDir);
      isDir = s.isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const manifestPath = join(moduleDir, MANIFEST_FILE);
    let manifestText: string;
    try {
      manifestText = await readFile(manifestPath, 'utf8');
    } catch {
      // Placeholder or partial install — skip silently.
      continue;
    }

    const manifest = parseManifestTres(manifestText);
    results.push({ manifestPath, moduleDir, manifest });
  }
  return results;
}

/**
 * Parses the subset of `.tres` fields we care about from a
 * `module.manifest.tres` file. The full Godot Resource format is
 * significantly more complex; we only need to pull scalar fields from
 * the `[resource]` section, so a line-by-line scanner is sufficient
 * and avoids pulling in a heavyweight parser.
 */
export function parseManifestTres(text: string): ModuleManifest {
  const manifest: ModuleManifest = {
    id: '',
    version: '',
    core_min_version: '',
    depends_on: [],
    license_id: '',
    source_repo: '',
  };

  const lines = text.split('\n');
  let inResource = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '[resource]') {
      inResource = true;
      continue;
    }
    if (trimmed.startsWith('[') && trimmed !== '[resource]') {
      inResource = false;
      continue;
    }
    if (!inResource || trimmed === '' || trimmed.startsWith(';')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();

    switch (key) {
      case 'id':
        manifest.id = stripStringNameOrString(value);
        break;
      case 'version':
        manifest.version = stripStringNameOrString(value);
        break;
      case 'core_min_version':
        manifest.core_min_version = stripStringNameOrString(value);
        break;
      case 'license_id':
        manifest.license_id = stripStringNameOrString(value);
        break;
      case 'source_repo':
        manifest.source_repo = stripStringNameOrString(value);
        break;
      case 'depends_on':
        manifest.depends_on = parseStringNameArray(value);
        break;
    }
  }
  return manifest;
}

/** Unwraps a `.tres` literal: `"foo"`, `&"foo"`, or bare `foo`. */
function stripStringNameOrString(raw: string): string {
  let v = raw.trim();
  if (v.startsWith('&')) v = v.slice(1);
  if (v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parses `Array[StringName](["a", "b"])` or `[&"a", &"b"]` into
 * `["a", "b"]`. The parse is intentionally forgiving: anything it
 * doesn't recognize yields an empty array, because a malformed
 * depends_on should not block the manifest summary.
 */
function parseStringNameArray(raw: string): string[] {
  const inner = extractArrayBody(raw);
  if (inner === null) return [];
  const items = splitTopLevelCommas(inner);
  return items
    .map((item) => stripStringNameOrString(item))
    .filter((item) => item !== '');
}

function extractArrayBody(raw: string): string | null {
  // The actual array body is always the innermost `[...]`, not any
  // leading type hint like `Array[StringName]` in a typed-array
  // constructor. Walking from the end finds the real opener reliably
  // for both `Array[StringName]([...])` and bare `[...]`.
  const close = raw.lastIndexOf(']');
  if (close === -1) return null;
  const open = raw.lastIndexOf('[', close - 1);
  if (open === -1 || close <= open) return null;
  return raw.slice(open + 1, close);
}

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  let inString = false;
  for (const ch of body) {
    if (ch === '"') inString = !inString;
    if (!inString) {
      if (ch === '[' || ch === '(') depth++;
      if (ch === ']' || ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(buf.trim());
        buf = '';
        continue;
      }
    }
    buf += ch;
  }
  if (buf.trim() !== '') parts.push(buf.trim());
  return parts;
}
