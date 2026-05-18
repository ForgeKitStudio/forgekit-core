/**
 * MCP server startup wiring for license discovery.
 *
 * On boot, the server looks at the on-disk mirror of Godot's
 * `user://licenses/` directory, reads every `<module_id>.key` file, and
 * derives the set of tool modules that should be exposed beyond the
 * base profile. A single valid `forgekit_rpg.key` record unlocks the
 * fifteen RPG subsystems (combat, crafting, inventory, stats, effects,
 * magic, equipment, progression, enemies, loot, spawner, chests, npc,
 * dialog, vendor) in line with the licensing acceptance criteria.
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

/** Default interval (ms) at which `watchLicenseDir` polls the directory. */
const DEFAULT_WATCH_POLL_MS = 250;

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
  forgekit_rpg: [
    'combat',
    'crafting',
    'inventory',
    'stats',
    'effects',
    'magic',
    'equipment',
    'progression',
    'enemies',
    'loot',
    'spawner',
    'chests',
    'npc',
    'dialog',
    'vendor',
  ],
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


/** Listener invoked whenever the contents of the license directory change. */
export type LicenseDirChangeListener = () => void | Promise<void>;

/** Handle returned by `watchLicenseDir` so callers can detach. */
export interface LicenseDirWatcher {
  /** Stop watching and release any underlying resources. */
  close(): Promise<void>;
}

export interface WatchLicenseDirOptions {
  /**
   * Polling interval in milliseconds. The watcher uses a directory-listing
   * polling strategy so it works uniformly across platforms (macOS, Linux,
   * Windows) and copes with the directory not existing yet. Defaults to
   * 250 ms — small enough to feel instantaneous in interactive sessions
   * but large enough to keep CPU cost negligible.
   */
  readonly pollMs?: number;
  /** Optional logger surface used for transient errors during polling. */
  readonly logger?: LicenseLogger;
}

/**
 * Watches `licenseDir` for changes to any `*.key` file (creation,
 * deletion, content change) and invokes `listener` on every change.
 *
 * The watcher uses periodic directory listing rather than `fs.watch`
 * because:
 *   - `fs.watch` rejects when the target directory does not yet exist;
 *     callers expect the watcher to start before the first license
 *     activation has happened.
 *   - `fs.watch` semantics differ between macOS, Linux, and Windows in
 *     ways that make the rapid-create-then-delete sequence used by the
 *     test suite unreliable.
 *
 * The listener fires when any of these change between polls:
 *   - the set of `*.key` filenames present in the directory
 *   - the size of any `*.key` file
 *   - the modification time of any `*.key` file
 *
 * The listener never blocks the polling loop: rejected promises are
 * caught and reported through `options.logger.warn` (when supplied).
 */
export async function watchLicenseDir(
  licenseDir: string,
  listener: LicenseDirChangeListener,
  options: WatchLicenseDirOptions = {},
): Promise<LicenseDirWatcher> {
  const pollMs = options.pollMs ?? DEFAULT_WATCH_POLL_MS;
  const logger = options.logger;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let snapshot = await snapshotKeyFiles(licenseDir);

  const tick = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      const next = await snapshotKeyFiles(licenseDir);
      if (!snapshotsEqual(snapshot, next)) {
        snapshot = next;
        try {
          await listener();
        } catch (err) {
          logger?.warn(
            `[license] watcher listener threw: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      logger?.warn(
        `[license] watcher poll failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void tick();
        }, pollMs);
      }
    }
  };

  timer = setTimeout(() => {
    void tick();
  }, pollMs);

  return {
    async close(): Promise<void> {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

interface KeyFileFingerprint {
  readonly size: number;
  readonly mtimeMs: number;
}

type KeySnapshot = ReadonlyMap<string, KeyFileFingerprint>;

async function snapshotKeyFiles(licenseDir: string): Promise<KeySnapshot> {
  let entries: string[];
  try {
    entries = await readdir(licenseDir);
  } catch {
    return new Map();
  }

  const snapshot = new Map<string, KeyFileFingerprint>();
  for (const entry of entries) {
    if (!entry.endsWith('.key')) {
      continue;
    }
    const filePath = join(licenseDir, entry);
    try {
      const s = await stat(filePath);
      if (!s.isFile()) {
        continue;
      }
      snapshot.set(entry, { size: s.size, mtimeMs: s.mtimeMs });
    } catch {
      // File disappeared between readdir and stat; skip and let the
      // next poll catch up.
      continue;
    }
  }
  return snapshot;
}

function snapshotsEqual(a: KeySnapshot, b: KeySnapshot): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [name, fp] of a) {
    const other = b.get(name);
    if (other === undefined) {
      return false;
    }
    if (other.size !== fp.size || other.mtimeMs !== fp.mtimeMs) {
      return false;
    }
  }
  return true;
}
