/**
 * MCP server startup wiring for license discovery.
 *
 * On boot, the server looks at the on-disk mirror of Godot's
 * `user://licenses/` directory, reads every `<module_id>.key` file, and
 * derives the set of tool modules that should be exposed beyond the
 * base profile. A single valid `forgekit_rpg.key` record unlocks the
 * four RPG subsystems (combat, crafting, inventory, stats) in line with
 * the licensing acceptance criteria.
 *
 * This module wraps the pure helpers in `./license_directory.ts` with
 * the filesystem I/O required to read the license records. All I/O is
 * best-effort: missing directories, missing files, and malformed
 * entries are skipped silently (with a warning via an injectable
 * logger), so the server never fails to start because of licensing.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir as defaultHomedir } from 'node:os';
import { basename, join } from 'node:path';

import type { ToolModule } from '../profiles.js';
import {
  parseProjectName,
  resolveUserLicenseDir,
} from './license_directory.js';

/** Shape of a persisted license record (one file per module id). */
export interface LicenseRecord {
  readonly license_id: string;
  readonly activated_at: string;
  readonly fingerprint: string;
}

/** Minimal logger surface used for warnings. */
export interface LicenseLogger {
  warn(message: string): void;
}

export interface LoadActiveLicensesOptions {
  readonly logger?: LicenseLogger;
}

/** Map of module id to license record. Keys are the filename stem. */
export type LicenseRecordMap = Readonly<Record<string, LicenseRecord>>;

/**
 * Reads every `<module_id>.key` file under `licenseDir` and returns a
 * map of module id to license record. Missing directories yield an
 * empty map. Malformed files are skipped and reported through
 * `options.logger.warn`; a missing logger silently discards warnings.
 */
export async function loadActiveLicenses(
  licenseDir: string,
  options: LoadActiveLicensesOptions = {},
): Promise<LicenseRecordMap> {
  const logger = options.logger;
  let entries: string[];
  try {
    entries = await readdir(licenseDir);
  } catch {
    return {};
  }

  const records: Record<string, LicenseRecord> = {};
  for (const entry of entries) {
    if (!entry.endsWith('.key')) {
      continue;
    }
    const filePath = join(licenseDir, entry);
    let text: string;
    try {
      const s = await stat(filePath);
      if (!s.isFile()) {
        continue;
      }
      text = await readFile(filePath, 'utf8');
    } catch (err) {
      logger?.warn(
        `[license] failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      logger?.warn(
        `[license] skipping malformed ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const record = coerceLicenseRecord(parsed);
    if (record === null) {
      logger?.warn(`[license] skipping ${filePath}: missing required fields`);
      continue;
    }

    const moduleId = basename(entry, '.key');
    records[moduleId] = record;
  }

  return records;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function coerceLicenseRecord(value: unknown): LicenseRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const { license_id, activated_at, fingerprint } = value;
  if (
    typeof license_id !== 'string' ||
    typeof activated_at !== 'string' ||
    typeof fingerprint !== 'string'
  ) {
    return null;
  }
  return { license_id, activated_at, fingerprint };
}

/** Map from module id to the set of tool modules it unlocks. */
const MODULE_ID_TO_UNLOCKED: Readonly<Record<string, ReadonlyArray<ToolModule>>> =
  {
    forgekit_rpg: ['combat', 'crafting', 'inventory', 'stats'],
  };

/**
 * Derives the set of tool modules that should be additionally exposed
 * based on the license records present. Unknown module ids are
 * ignored. Returns an empty set when no records match.
 */
export function unlockedModulesFromLicenses(
  records: LicenseRecordMap,
): ReadonlySet<ToolModule> {
  const out = new Set<ToolModule>();
  for (const moduleId of Object.keys(records)) {
    const unlocks = MODULE_ID_TO_UNLOCKED[moduleId];
    if (unlocks === undefined) {
      continue;
    }
    for (const m of unlocks) {
      out.add(m);
    }
  }
  return out;
}

/** Inputs for `resolveLicenseDir`. */
export interface ResolveLicenseDirOptions {
  /** Project root used to locate `project.godot`. */
  readonly projectRoot: string;
  /**
   * Explicit override. When provided it is returned as-is and no
   * platform resolution or project.godot read is performed.
   */
  readonly licenseDir?: string;
  /** Platform override for testing. Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform | string;
  /** Environment override for testing. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Homedir override for testing. Defaults to `os.homedir()`. */
  readonly homedir?: string;
}

/**
 * Composes `resolveUserLicenseDir` with a read of `project.godot` to
 * produce the absolute path to the host-side mirror of
 * `user://licenses/`. When `project.godot` is missing or lacks a
 * `config/name` key, the resolver falls back to the project root's
 * directory name, matching Godot's own behaviour for unnamed projects.
 */
export async function resolveLicenseDir(
  options: ResolveLicenseDirOptions,
): Promise<string> {
  if (options.licenseDir !== undefined) {
    return options.licenseDir;
  }

  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? defaultHomedir();

  const projectGodotPath = join(options.projectRoot, 'project.godot');
  let projectName: string | null = null;
  try {
    const raw = await readFile(projectGodotPath, 'utf8');
    projectName = parseProjectName(raw);
  } catch {
    // project.godot missing or unreadable; fall back below.
  }

  if (projectName === null || projectName === '') {
    projectName = basename(options.projectRoot);
  }

  return resolveUserLicenseDir({ platform, env, homedir, projectName });
}
