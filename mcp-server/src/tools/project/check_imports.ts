/**
 * Implementation of the `project.check_imports` MCP tool.
 *
 * Walks every `.gd` file under `<projectRoot>/addons/forgekit_core/**`
 * and `<projectRoot>/addons/forgekit_rpg/**`, extracts every
 * `preload("res://...")`, `load("res://...")`, and
 * `extends "res://..."` reference, and applies two rules:
 *
 *   Rule 1.2 — ForgeKit_Core → non-core forgekit module is forbidden.
 *   Rule 1.3 — `forgekit_rpg/<subsystem>/` may only reach other
 *              subsystems via `forgekit_rpg/public_api.gd`. Imports of
 *              other `forgekit_*` addons (not `forgekit_core`) are
 *              forbidden outright.
 *
 * All bad imports from the same file are aggregated into a single
 * `{file, imports, reason}` entry — consumers (CI, self-healing loop)
 * act on files, not on individual lines.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { ToolInputError } from './errors.js';

export interface CheckImportsParams {
  projectRoot: string;
}

export interface ImportViolation {
  /** Project-relative path with forward slashes. */
  file: string;
  /** Each offending `res://` target referenced by the file. */
  imports: string[];
  /** English explanation of which rule was broken. */
  reason: string;
}

export interface CheckImportsResult {
  violations: ImportViolation[];
}

const CORE_PREFIX = 'res://addons/forgekit_core/';
const RPG_ROOT = 'res://addons/forgekit_rpg/';
const RPG_PUBLIC_API = 'res://addons/forgekit_rpg/public_api.gd';

// Matches preload("res://..."), load("res://..."), and extends "res://...".
// Allows single or double quotes; captures the `res://...` string.
const IMPORT_PATTERNS: RegExp[] = [
  /\bpreload\s*\(\s*["'](res:\/\/[^"']+)["']\s*\)/g,
  /\bload\s*\(\s*["'](res:\/\/[^"']+)["']\s*\)/g,
  /\bextends\s+["'](res:\/\/[^"']+)["']/g,
];

export async function checkImports(
  params: CheckImportsParams,
): Promise<CheckImportsResult> {
  if (
    typeof params.projectRoot !== 'string' ||
    params.projectRoot.trim() === ''
  ) {
    throw new ToolInputError(
      `"projectRoot" must be a non-empty string (got ${JSON.stringify(params.projectRoot)}).`,
    );
  }

  const roots = [
    join(params.projectRoot, 'addons', 'forgekit_core'),
    join(params.projectRoot, 'addons', 'forgekit_rpg'),
  ];

  const violations: ImportViolation[] = [];
  for (const root of roots) {
    const gdFiles = await collectGdFiles(root);
    for (const absFile of gdFiles) {
      const rel = toPosix(relative(params.projectRoot, absFile));
      const imports = await extractResImports(absFile);
      const violation = classifyFile(rel, imports);
      if (violation !== null) {
        violations.push(violation);
      }
    }
  }
  return { violations };
}

async function collectGdFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(root, name);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      const nested = await collectGdFiles(full);
      for (const f of nested) out.push(f);
    } else if (s.isFile() && name.endsWith('.gd')) {
      out.push(full);
    }
  }
  return out;
}

async function extractResImports(absFile: string): Promise<string[]> {
  const text = await readFile(absFile, 'utf8');
  const seen: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const target = match[1];
      if (!seen.includes(target)) seen.push(target);
    }
  }
  return seen;
}

function classifyFile(
  relFile: string,
  imports: string[],
): ImportViolation | null {
  if (relFile.startsWith('addons/forgekit_core/')) {
    return classifyCoreFile(relFile, imports);
  }
  if (relFile.startsWith('addons/forgekit_rpg/')) {
    return classifyRpgFile(relFile, imports);
  }
  return null;
}

function classifyCoreFile(
  relFile: string,
  imports: string[],
): ImportViolation | null {
  const bad: string[] = [];
  for (const target of imports) {
    if (!target.startsWith('res://addons/forgekit_')) continue;
    if (target.startsWith(CORE_PREFIX)) continue;
    bad.push(target);
  }
  if (bad.length === 0) return null;
  return {
    file: relFile,
    imports: bad,
    reason:
      'ForgeKit_Core files must not import from other forgekit_* modules; ' +
      `offending targets include ${bad[0]}.`,
  };
}

function classifyRpgFile(
  relFile: string,
  imports: string[],
): ImportViolation | null {
  // `addons/forgekit_rpg/<subsystem>/...` → subsystem is the 3rd path
  // segment. Files that sit directly under `addons/forgekit_rpg/` (like
  // `public_api.gd`) don't count as "inside a subsystem".
  const segments = relFile.split('/');
  const subsystem = segments.length >= 4 ? segments[2] : '';

  // `public_api.gd` is the explicit aggregator: rule 1.3 requires other
  // subsystems to reach each other through it, which means public_api
  // itself necessarily imports from every subsystem. Exempt it from the
  // cross-subsystem check — it still may not reach OTHER forgekit_*
  // modules (rule 1.2), only its own subsystems.
  const isPublicApi = relFile === 'addons/forgekit_rpg/public_api.gd';

  const bad: string[] = [];
  let rule13Reason: string | null = null;
  for (const target of imports) {
    if (target.startsWith(CORE_PREFIX)) continue;
    if (target === RPG_PUBLIC_API) continue;
    if (target.startsWith(RPG_ROOT)) {
      // Self-imports within the same subsystem are fine.
      if (
        subsystem !== '' &&
        target.startsWith(`${RPG_ROOT}${subsystem}/`)
      ) {
        continue;
      }
      // public_api.gd re-exports every subsystem by design.
      if (isPublicApi) continue;
      bad.push(target);
      rule13Reason =
        'forgekit_rpg subsystems must reach other subsystems only through ' +
        'addons/forgekit_rpg/public_api.gd.';
      continue;
    }
    if (target.startsWith('res://addons/forgekit_')) {
      bad.push(target);
      const otherModule =
        target.match(/^res:\/\/addons\/(forgekit_[^/]+)\//)?.[1] ?? 'other';
      rule13Reason =
        `files under addons/forgekit_rpg/ must not import from another module (${otherModule}).`;
      continue;
    }
  }
  if (bad.length === 0) return null;
  return {
    file: relFile,
    imports: bad,
    reason: rule13Reason ?? 'forbidden import',
  };
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}
