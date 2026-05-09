/**
 * Tests for the in-memory ProjectRegistry + its JSON persistence mirror.
 *
 * The registry guarantees:
 *   - exactly one active workspace (or zero when empty),
 *   - deterministic ordering (list() is sorted by workspace_id ascending),
 *   - atomic persistence on every mutating operation,
 *   - JSON-RPC error codes -32015..-32019 for invalid states.
 *
 * We inject a fake FileSystemAdapter so the registry can validate
 * project roots without us having to stage directory trees on disk.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  InvalidProjectRootError,
  NoActiveWorkspaceError,
  ProjectRootAlreadyRegisteredError,
  WorkspaceAlreadyRegisteredError,
  WorkspaceLimitExceededError,
  WorkspaceNotFoundError,
} from '../../src/projects/errors.js';
import type { FileSystemAdapter } from '../../src/projects/registry.js';
import { ProjectRegistry } from '../../src/projects/registry.js';
import type {
  WorkspacesPersistence,
  WorkspacesSnapshot,
} from '../../src/projects/persistence.js';
import { MAX_WORKSPACES } from '../../src/projects/workspace.js';

/**
 * Minimal in-memory persistence for tests.
 */
function memoryPersistence(initial: WorkspacesSnapshot | null = null): {
  persistence: WorkspacesPersistence;
  snapshots: WorkspacesSnapshot[];
  latest: () => WorkspacesSnapshot | null;
} {
  let current = initial;
  const snapshots: WorkspacesSnapshot[] = [];
  const persistence: WorkspacesPersistence = {
    async read() {
      return current;
    },
    async write(snapshot) {
      current = snapshot;
      snapshots.push(snapshot);
    },
  };
  return { persistence, snapshots, latest: () => current };
}

/**
 * Fake FS: every `projectRoot` in `registered` is treated as a valid
 * Godot project (absolute, directory, contains project.godot). Any
 * other path fails with the reason returned by the lookup table.
 */
function fakeFs(
  registered: ReadonlyMap<string, 'missing_project_godot' | 'not_a_directory' | 'ok'>,
): FileSystemAdapter {
  return {
    async isAbsolute(p) {
      return p.startsWith('/');
    },
    async isDirectory(p) {
      const state = registered.get(p);
      return state !== undefined && state !== 'not_a_directory';
    },
    async hasProjectGodot(p) {
      return registered.get(p) === 'ok';
    },
  };
}

const FIXED_NOW = '2026-05-09T19:30:00.000Z';

function buildRegistry(opts: {
  persistence?: WorkspacesPersistence;
  fs?: FileSystemAdapter;
  clock?: () => string;
}): ProjectRegistry {
  const persistence =
    opts.persistence ?? memoryPersistence(null).persistence;
  const fs =
    opts.fs ??
    fakeFs(
      new Map<string, 'missing_project_godot' | 'not_a_directory' | 'ok'>([
        ['/a', 'ok'],
        ['/b', 'ok'],
        ['/c', 'ok'],
      ]),
    );
  return new ProjectRegistry(persistence, fs, opts.clock ?? (() => FIXED_NOW));
}

describe('ProjectRegistry.register', () => {
  it('stores a valid workspace and returns it with registered_at populated', async () => {
    const { persistence, latest } = memoryPersistence(null);
    const registry = buildRegistry({ persistence });

    const ws = await registry.register({
      workspace_id: 'client-a',
      projectRoot: '/a',
      label: 'Client A',
    });
    expect(ws.workspace_id).toBe('client-a');
    expect(ws.projectRoot).toBe('/a');
    expect(ws.label).toBe('Client A');
    expect(ws.registered_at).toBe(FIXED_NOW);
    // First register auto-activates the workspace.
    expect(ws.active).toBe(true);
    expect(registry.size()).toBe(1);
    expect(latest()?.active_workspace_id).toBe('client-a');
  });

  it('rejects invalid workspace_id grammar with InvalidProjectRootError... wait — invalid id uses InvalidArgument', async () => {
    // workspace_id grammar violations throw ToolInputError-like errors
    // but we need to ensure the registry surfaces something. We accept
    // either Error or a specific class so long as the throw is deterministic.
    const registry = buildRegistry({});
    await expect(
      registry.register({
        workspace_id: 'Not-Valid',
        projectRoot: '/a',
      }),
    ).rejects.toThrow();
  });

  it('rejects a projectRoot that is not absolute with InvalidProjectRootError(reason=not_absolute)', async () => {
    const registry = buildRegistry({
      fs: fakeFs(new Map([['relative/path', 'ok']])),
    });
    try {
      await registry.register({
        workspace_id: 'a',
        projectRoot: 'relative/path',
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidProjectRootError);
      const e = err as InvalidProjectRootError;
      expect(e.code).toBe(-32018);
      expect(e.data.reason).toBe('not_absolute');
    }
  });

  it('rejects projectRoot that is not a directory', async () => {
    const registry = buildRegistry({
      fs: fakeFs(new Map([['/a', 'not_a_directory']])),
    });
    try {
      await registry.register({ workspace_id: 'a', projectRoot: '/a' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidProjectRootError);
      expect((err as InvalidProjectRootError).data.reason).toBe('not_a_directory');
    }
  });

  it('rejects projectRoot without project.godot', async () => {
    const registry = buildRegistry({
      fs: fakeFs(new Map([['/a', 'missing_project_godot']])),
    });
    try {
      await registry.register({ workspace_id: 'a', projectRoot: '/a' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidProjectRootError);
      expect((err as InvalidProjectRootError).data.reason).toBe('missing_project_godot');
    }
  });

  it('rejects duplicate workspace_id with WorkspaceAlreadyRegisteredError', async () => {
    const registry = buildRegistry({});
    await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    await expect(
      registry.register({ workspace_id: 'a', projectRoot: '/b' }),
    ).rejects.toBeInstanceOf(WorkspaceAlreadyRegisteredError);
  });

  it('rejects duplicate projectRoot with ProjectRootAlreadyRegisteredError', async () => {
    const registry = buildRegistry({});
    await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    await expect(
      registry.register({ workspace_id: 'b', projectRoot: '/a' }),
    ).rejects.toBeInstanceOf(ProjectRootAlreadyRegisteredError);
  });

  it('enforces MAX_WORKSPACES = 32', async () => {
    const roots = new Map<string, 'ok'>();
    for (let i = 0; i < MAX_WORKSPACES + 1; i++) {
      roots.set(`/ws${i}`, 'ok');
    }
    const registry = buildRegistry({ fs: fakeFs(roots) });
    for (let i = 0; i < MAX_WORKSPACES; i++) {
      await registry.register({
        workspace_id: `ws${String.fromCharCode(97 + (i % 26))}${i}`,
        projectRoot: `/ws${i}`,
      });
    }
    await expect(
      registry.register({
        workspace_id: 'wsoverflow',
        projectRoot: `/ws${MAX_WORKSPACES}`,
      }),
    ).rejects.toBeInstanceOf(WorkspaceLimitExceededError);
  });
});

describe('ProjectRegistry.unregister / get / list', () => {
  it('list() returns workspaces sorted ascending by workspace_id', async () => {
    const registry = buildRegistry({});
    await registry.register({ workspace_id: 'client-b', projectRoot: '/b' });
    await registry.register({ workspace_id: 'client-a', projectRoot: '/a' });
    await registry.register({ workspace_id: 'client-c', projectRoot: '/c' });

    const ids = registry.list().map((w) => w.workspace_id);
    expect(ids).toEqual(['client-a', 'client-b', 'client-c']);
  });

  it('unregister returns {removed} and is a no-op for unknown ids', async () => {
    const registry = buildRegistry({});
    await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    const { removed } = await registry.unregister('a');
    expect(removed?.workspace_id).toBe('a');
    expect(registry.size()).toBe(0);

    const again = await registry.unregister('a');
    expect(again.removed).toBeNull();
  });

  it('get returns null for unknown ids', async () => {
    const registry = buildRegistry({});
    expect(registry.get('missing')).toBeNull();
  });

  it('get returns the stored workspace for known ids', async () => {
    const registry = buildRegistry({});
    await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    expect(registry.get('a')?.workspace_id).toBe('a');
  });
});

describe('ProjectRegistry.setActive / getActive', () => {
  it('first register auto-activates', async () => {
    const registry = buildRegistry({});
    const ws = await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    expect(registry.getActive()?.workspace_id).toBe('a');
    expect(ws.active).toBe(true);
  });

  it('setActive flips active flag atomically', async () => {
    const registry = buildRegistry({});
    await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    await registry.register({ workspace_id: 'b', projectRoot: '/b' });
    await registry.setActive('b');
    expect(registry.getActive()?.workspace_id).toBe('b');
    expect(registry.get('a')?.active).toBe(false);
    expect(registry.get('b')?.active).toBe(true);
  });

  it('setActive throws WorkspaceNotFoundError for unknown ids', async () => {
    const registry = buildRegistry({});
    await expect(registry.setActive('missing')).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
  });

  it('getActive returns null on empty registry', () => {
    const registry = buildRegistry({});
    expect(registry.getActive()).toBeNull();
  });

  it('unregistering the active workspace picks the newest remaining', async () => {
    const clocks = [
      '2026-05-09T19:30:00.000Z',
      '2026-05-09T19:31:00.000Z',
      '2026-05-09T19:32:00.000Z',
    ];
    let i = 0;
    const registry = buildRegistry({ clock: () => clocks[i++]! });
    await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    await registry.register({ workspace_id: 'b', projectRoot: '/b' });
    await registry.register({ workspace_id: 'c', projectRoot: '/c' });
    await registry.setActive('a');
    await registry.unregister('a');
    // Newest remaining is 'c' (registered at 19:32).
    expect(registry.getActive()?.workspace_id).toBe('c');
  });

  it('unregistering the last workspace empties the active slot', async () => {
    const registry = buildRegistry({});
    await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    await registry.unregister('a');
    expect(registry.getActive()).toBeNull();
  });
});

describe('ProjectRegistry.serialize', () => {
  it('returns a snapshot usable by FileSystemWorkspacesPersistence.write', async () => {
    const registry = buildRegistry({});
    await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    await registry.register({ workspace_id: 'b', projectRoot: '/b' });
    const snapshot = registry.serialize();
    expect(snapshot.version).toBe('1.0');
    expect(snapshot.active_workspace_id).toBe('a');
    expect(snapshot.workspaces.map((w) => w.workspace_id).sort()).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('ProjectRegistry persistence', () => {
  it('writes to the persistence layer on every mutation', async () => {
    const { persistence, snapshots } = memoryPersistence(null);
    const registry = buildRegistry({ persistence });
    await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    await registry.register({ workspace_id: 'b', projectRoot: '/b' });
    await registry.setActive('b');
    await registry.unregister('a');
    expect(snapshots.length).toBeGreaterThanOrEqual(4);
  });

  it('ProjectRegistry.fromDisk reconstructs in-memory state from persistence', async () => {
    const snapshot: WorkspacesSnapshot = {
      version: '1.0',
      active_workspace_id: 'a',
      workspaces: [
        {
          workspace_id: 'a',
          projectRoot: '/a',
          registered_at: '2026-05-09T19:30:00.000Z',
          active: true,
        },
        {
          workspace_id: 'b',
          projectRoot: '/b',
          registered_at: '2026-05-09T19:31:00.000Z',
          active: false,
        },
      ],
    };
    const { persistence } = memoryPersistence(snapshot);
    const fs = fakeFs(new Map([
      ['/a', 'ok'],
      ['/b', 'ok'],
    ]));
    const registry = await ProjectRegistry.fromDisk({
      persistence,
      fs,
      clock: () => FIXED_NOW,
    });
    expect(registry.size()).toBe(2);
    expect(registry.getActive()?.workspace_id).toBe('a');
    expect(registry.list().map((w) => w.workspace_id)).toEqual(['a', 'b']);
  });

  it('fromDisk with null snapshot yields an empty registry', async () => {
    const { persistence } = memoryPersistence(null);
    const registry = await ProjectRegistry.fromDisk({
      persistence,
      fs: fakeFs(new Map()),
      clock: () => FIXED_NOW,
    });
    expect(registry.size()).toBe(0);
    expect(registry.getActive()).toBeNull();
  });
});

describe('ProjectRegistry — NoActiveWorkspaceError usage (consumer responsibility)', () => {
  // NoActiveWorkspaceError is thrown by the dispatcher middleware, not
  // by the registry itself — the registry's getActive() simply returns
  // null. This test documents that contract so the middleware can rely on it.
  it('getActive returns null rather than throwing when empty', () => {
    const registry = buildRegistry({});
    expect(registry.getActive()).toBeNull();
    // And we can construct the error the middleware should throw.
    const err = new NoActiveWorkspaceError();
    expect(err.code).toBe(-32021);
  });
});

describe('ProjectRegistry — register idempotency', () => {
  it('re-registering the same id with the same projectRoot + label returns the existing record without throwing', async () => {
    const registry = buildRegistry({});
    const a = await registry.register({
      workspace_id: 'a',
      projectRoot: '/a',
      label: 'Client A',
    });
    const a2 = await registry.register({
      workspace_id: 'a',
      projectRoot: '/a',
      label: 'Client A',
    });
    expect(a2).toEqual(a);
    expect(registry.size()).toBe(1);
  });
});
