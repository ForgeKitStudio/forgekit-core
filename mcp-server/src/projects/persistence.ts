/**
 * Persistence layer for the multi-project workspace registry.
 *
 * Writes a snapshot of the registry to
 * `<homeDir>/.forgekit/workspaces.json` atomically using a sibling
 * `.tmp` file + `rename` (the same pattern the active-ports writer in
 * `health_endpoint.ts` uses). Reads return `null` when the file is
 * missing or malformed; malformed files emit a warning through the
 * injected logger so the operator has a trail but startup can
 * continue with a fresh in-memory registry.
 */

import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir as defaultHomedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { Workspace } from './workspace.js';

/** Minimal logger surface used for warnings. */
export interface PersistenceLogger {
  warn(message: string): void;
}

/** On-disk snapshot format; `version` is pinned for forward compatibility. */
export interface WorkspacesSnapshot {
  version: '1.0';
  active_workspace_id: string | null;
  workspaces: Workspace[];
}

/** Abstract persistence surface for dependency injection in tests. */
export interface WorkspacesPersistence {
  read(): Promise<WorkspacesSnapshot | null>;
  write(snapshot: WorkspacesSnapshot): Promise<void>;
}

export interface FileSystemWorkspacesPersistenceOptions {
  /** Override `$HOME` for tests. Defaults to `os.homedir()`. */
  homeDir?: string;
  /** Receives warnings for malformed JSON. Defaults to a no-op. */
  logger?: PersistenceLogger;
}

export const WORKSPACES_FILE_NAME = 'workspaces.json';
export const FORGEKIT_DIR_NAME = '.forgekit';

/**
 * Filesystem-backed implementation writing to
 * `<homeDir>/.forgekit/workspaces.json`. Safe to construct any number
 * of instances — this class owns no state beyond its configuration.
 */
export class FileSystemWorkspacesPersistence implements WorkspacesPersistence {
  private readonly homeDir: string;
  private readonly logger: PersistenceLogger;

  constructor(options: FileSystemWorkspacesPersistenceOptions = {}) {
    this.homeDir = options.homeDir ?? defaultHomedir();
    this.logger = options.logger ?? { warn: () => undefined };
  }

  /** Absolute path to `<homeDir>/.forgekit/workspaces.json`. */
  path(): string {
    return join(this.homeDir, FORGEKIT_DIR_NAME, WORKSPACES_FILE_NAME);
  }

  async read(): Promise<WorkspacesSnapshot | null> {
    const path = this.path();
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return null;
      }
      this.logger.warn(`[workspaces] failed to read ${path}: ${errText(err)}`);
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.logger.warn(
        `[workspaces] ${path} is not valid JSON (${errText(err)}); ignoring file.`,
      );
      return null;
    }

    const snapshot = coerceSnapshot(parsed);
    if (snapshot === null) {
      this.logger.warn(
        `[workspaces] ${path} does not match the expected schema; ignoring file.`,
      );
      return null;
    }
    return snapshot;
  }

  async write(snapshot: WorkspacesSnapshot): Promise<void> {
    const dir = join(this.homeDir, FORGEKIT_DIR_NAME);
    await mkdir(dir, { recursive: true });
    const finalPath = this.path();
    const suffix = randomBytes(4).toString('hex');
    const tempPath = `${finalPath}.${suffix}.tmp`;
    const payload = JSON.stringify(snapshot, null, 2) + '\n';
    try {
      await writeFile(tempPath, payload, { encoding: 'utf8' });
      await rename(tempPath, finalPath);
    } catch (err) {
      try {
        await unlink(tempPath);
      } catch {
        // ignore cleanup failures
      }
      throw err;
    }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function coerceSnapshot(value: unknown): WorkspacesSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.version !== '1.0') {
    return null;
  }
  const active = value.active_workspace_id;
  if (active !== null && typeof active !== 'string') {
    return null;
  }
  if (!Array.isArray(value.workspaces)) {
    return null;
  }
  const workspaces: Workspace[] = [];
  for (const entry of value.workspaces) {
    const ws = coerceWorkspace(entry);
    if (ws === null) {
      return null;
    }
    workspaces.push(ws);
  }
  return {
    version: '1.0',
    active_workspace_id: active,
    workspaces,
  };
}

function coerceWorkspace(value: unknown): Workspace | null {
  if (!isRecord(value)) {
    return null;
  }
  const { workspace_id, projectRoot, label, registered_at, active } = value;
  if (
    typeof workspace_id !== 'string' ||
    typeof projectRoot !== 'string' ||
    typeof registered_at !== 'string' ||
    typeof active !== 'boolean'
  ) {
    return null;
  }
  if (label !== undefined && typeof label !== 'string') {
    return null;
  }
  const out: Workspace = {
    workspace_id,
    projectRoot,
    registered_at,
    active,
  };
  if (typeof label === 'string') {
    (out as { label?: string }).label = label;
  }
  return out;
}
