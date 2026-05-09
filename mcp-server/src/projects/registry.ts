/**
 * In-memory singleton registry of the MCP server's known Godot projects.
 *
 * The registry is the sole owner of workspace lifecycle state. It
 * mutates atomically (JS is single-threaded) and mirrors every write
 * through the injected `WorkspacesPersistence` so restarts rehydrate
 * the same set. Filesystem validation of the `projectRoot` argument is
 * delegated to an injected `FileSystemAdapter` so tests don't have to
 * stage real project trees.
 *
 * The registry never throws for operations on unknown ids outside of
 * `setActive`; `get()` returns null and `unregister()` returns
 * `{removed: null}`. Missing-active semantics are the responsibility
 * of the dispatcher middleware, which inspects `getActive()` and
 * translates null into a `NoActiveWorkspaceError`.
 */

import { stat as fsStat } from 'node:fs/promises';
import { isAbsolute as pathIsAbsolute, join } from 'node:path';

import {
  InvalidProjectRootError,
  ProjectRootAlreadyRegisteredError,
  WorkspaceAlreadyRegisteredError,
  WorkspaceLimitExceededError,
  WorkspaceNotFoundError,
} from './errors.js';
import type {
  WorkspacesPersistence,
  WorkspacesSnapshot,
} from './persistence.js';
import {
  MAX_WORKSPACES,
  type Workspace,
  validateLabel,
  validateWorkspaceId,
} from './workspace.js';

/** Dependency-inverted filesystem surface for register-time validation. */
export interface FileSystemAdapter {
  /** Returns true when `p` is an absolute path in the host's POSIX/NT sense. */
  isAbsolute(p: string): Promise<boolean> | boolean;
  /** Returns true when `p` exists and is a directory. */
  isDirectory(p: string): Promise<boolean>;
  /** Returns true when `p + /project.godot` exists as a regular file. */
  hasProjectGodot(p: string): Promise<boolean>;
}

/**
 * Default POSIX/Node filesystem adapter backed by `node:fs/promises`.
 */
export const nodeFileSystemAdapter: FileSystemAdapter = {
  isAbsolute(p) {
    return pathIsAbsolute(p);
  },
  async isDirectory(p) {
    try {
      const s = await fsStat(p);
      return s.isDirectory();
    } catch {
      return false;
    }
  },
  async hasProjectGodot(p) {
    try {
      const s = await fsStat(join(p, 'project.godot'));
      return s.isFile();
    } catch {
      return false;
    }
  },
};

/** Arguments for `ProjectRegistry.register`. */
export interface RegisterArgs {
  workspace_id: string;
  projectRoot: string;
  label?: string;
}

/** Options for `ProjectRegistry.fromDisk`. */
export interface FromDiskOptions {
  persistence: WorkspacesPersistence;
  fs?: FileSystemAdapter;
  clock?: () => string;
}

/**
 * In-memory projectRegistry. Mutations flush to the persistence layer
 * synchronously (well, via awaited promise) so callers can await the
 * mutation and trust that a crash after the return will not lose the
 * change.
 */
export class ProjectRegistry {
  private readonly workspaces = new Map<string, Workspace>();
  private activeId: string | null = null;

  constructor(
    private readonly persistence: WorkspacesPersistence,
    private readonly fs: FileSystemAdapter = nodeFileSystemAdapter,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Construct a registry from an on-disk snapshot. When the
   * persistence layer returns `null`, the registry starts empty.
   */
  static async fromDisk(options: FromDiskOptions): Promise<ProjectRegistry> {
    const registry = new ProjectRegistry(
      options.persistence,
      options.fs ?? nodeFileSystemAdapter,
      options.clock,
    );
    const snapshot = await options.persistence.read();
    if (snapshot !== null) {
      registry.hydrate(snapshot);
    }
    return registry;
  }

  /** Hydrate from a snapshot without re-writing persistence. */
  private hydrate(snapshot: WorkspacesSnapshot): void {
    this.workspaces.clear();
    for (const ws of snapshot.workspaces) {
      this.workspaces.set(ws.workspace_id, { ...ws });
    }
    this.activeId = snapshot.active_workspace_id;
  }

  async register(args: RegisterArgs): Promise<Workspace> {
    const idResult = validateWorkspaceId(args.workspace_id);
    if (!idResult.valid) {
      throw new Error(`Invalid workspace_id: ${idResult.reason}`);
    }
    const labelResult = validateLabel(args.label);
    if (!labelResult.valid) {
      throw new Error(`Invalid label: ${labelResult.reason}`);
    }

    // Validate projectRoot path.
    if (!(await this.fs.isAbsolute(args.projectRoot))) {
      throw new InvalidProjectRootError(args.projectRoot, 'not_absolute');
    }
    if (!(await this.fs.isDirectory(args.projectRoot))) {
      throw new InvalidProjectRootError(args.projectRoot, 'not_a_directory');
    }
    if (!(await this.fs.hasProjectGodot(args.projectRoot))) {
      throw new InvalidProjectRootError(
        args.projectRoot,
        'missing_project_godot',
      );
    }

    // Idempotent re-register: same id + same projectRoot + same label.
    const existing = this.workspaces.get(args.workspace_id);
    if (existing !== undefined) {
      const labelMatches =
        (existing.label ?? undefined) === (args.label ?? undefined);
      if (existing.projectRoot === args.projectRoot && labelMatches) {
        return { ...existing };
      }
      throw new WorkspaceAlreadyRegisteredError(
        args.workspace_id,
        { ...existing },
      );
    }

    // Duplicate projectRoot under a different id.
    for (const ws of this.workspaces.values()) {
      if (ws.projectRoot === args.projectRoot) {
        throw new ProjectRootAlreadyRegisteredError(
          args.projectRoot,
          ws.workspace_id,
        );
      }
    }

    // Size limit.
    if (this.workspaces.size >= MAX_WORKSPACES) {
      throw new WorkspaceLimitExceededError(MAX_WORKSPACES, this.workspaces.size);
    }

    const workspace: Workspace = {
      workspace_id: args.workspace_id,
      projectRoot: args.projectRoot,
      registered_at: this.clock(),
      active: this.activeId === null, // first register auto-activates
      ...(args.label !== undefined ? { label: args.label } : {}),
    };
    this.workspaces.set(workspace.workspace_id, workspace);
    if (this.activeId === null) {
      this.activeId = workspace.workspace_id;
    }
    await this.flush();
    return { ...workspace };
  }

  async unregister(workspace_id: string): Promise<{ removed: Workspace | null }> {
    const existing = this.workspaces.get(workspace_id);
    if (existing === undefined) {
      return { removed: null };
    }
    const removed = { ...existing };
    this.workspaces.delete(workspace_id);

    if (this.activeId === workspace_id) {
      // Auto-switch to the most recently registered remaining workspace.
      this.activeId = this.pickNewestActiveCandidate();
      if (this.activeId !== null) {
        const ws = this.workspaces.get(this.activeId);
        if (ws !== undefined) {
          ws.active = true;
        }
      }
    }
    await this.flush();
    return { removed };
  }

  get(workspace_id: string): Workspace | null {
    const ws = this.workspaces.get(workspace_id);
    return ws ? { ...ws } : null;
  }

  list(): Workspace[] {
    return [...this.workspaces.values()]
      .sort((a, b) => (a.workspace_id < b.workspace_id ? -1 : a.workspace_id > b.workspace_id ? 1 : 0))
      .map((ws) => ({ ...ws }));
  }

  getActive(): Workspace | null {
    if (this.activeId === null) {
      return null;
    }
    const ws = this.workspaces.get(this.activeId);
    return ws ? { ...ws } : null;
  }

  async setActive(workspace_id: string): Promise<Workspace> {
    const ws = this.workspaces.get(workspace_id);
    if (ws === undefined) {
      throw new WorkspaceNotFoundError(workspace_id);
    }
    for (const other of this.workspaces.values()) {
      other.active = other.workspace_id === workspace_id;
    }
    this.activeId = workspace_id;
    await this.flush();
    return { ...ws };
  }

  size(): number {
    return this.workspaces.size;
  }

  serialize(): WorkspacesSnapshot {
    return {
      version: '1.0',
      active_workspace_id: this.activeId,
      workspaces: this.list(),
    };
  }

  /** Pick the workspace with the newest `registered_at` as the active fallback. */
  private pickNewestActiveCandidate(): string | null {
    let newest: Workspace | null = null;
    for (const ws of this.workspaces.values()) {
      if (newest === null || ws.registered_at > newest.registered_at) {
        newest = ws;
      }
    }
    return newest?.workspace_id ?? null;
  }

  private async flush(): Promise<void> {
    await this.persistence.write(this.serialize());
  }
}
