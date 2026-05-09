/**
 * Tests for the dispatcher's workspace-resolution middleware.
 *
 * The middleware is the single choke point that translates
 * `params.workspace_id` (or absence thereof) into a concrete
 * `(Workspace, projectRoot)` pair consumed by every tool handler.
 * Its four branches cover:
 *   1. explicit workspace_id + matching registered workspace,
 *   2. explicit workspace_id + unknown id (WORKSPACE_NOT_FOUND),
 *   3. no workspace_id + active workspace present (defaults to active),
 *   4. no workspace_id + empty registry (NO_ACTIVE_WORKSPACE).
 * Plus the projectRoot-mismatch guard on explicit `projectRoot`.
 */

import { describe, expect, it } from 'vitest';

import {
  NoActiveWorkspaceError,
  WorkspaceNotFoundError,
  WorkspaceRootMismatchError,
} from '../../src/projects/errors.js';
import type { FileSystemAdapter } from '../../src/projects/registry.js';
import { ProjectRegistry } from '../../src/projects/registry.js';
import type { WorkspacesPersistence } from '../../src/projects/persistence.js';
import { resolveWorkspace } from '../../src/projects/resolve_workspace.js';

function memoryPersistence(): WorkspacesPersistence {
  let current = null;
  return {
    async read() {
      return current;
    },
    async write() {
      // ignore
    },
  };
}

function fakeFs(okRoots: ReadonlySet<string>): FileSystemAdapter {
  return {
    isAbsolute(p) {
      return p.startsWith('/');
    },
    async isDirectory(p) {
      return okRoots.has(p);
    },
    async hasProjectGodot(p) {
      return okRoots.has(p);
    },
  };
}

async function seeded(ids: ReadonlyArray<{ id: string; root: string }>): Promise<ProjectRegistry> {
  const fs = fakeFs(new Set(ids.map((x) => x.root)));
  const registry = new ProjectRegistry(
    memoryPersistence(),
    fs,
    () => '2026-05-09T19:30:00.000Z',
  );
  for (const { id, root } of ids) {
    await registry.register({ workspace_id: id, projectRoot: root });
  }
  return registry;
}

describe('resolveWorkspace — explicit workspace_id', () => {
  it('returns the registered workspace when workspace_id resolves', async () => {
    const registry = await seeded([
      { id: 'a', root: '/a' },
      { id: 'b', root: '/b' },
    ]);
    const { workspace, projectRoot } = resolveWorkspace(registry, {
      workspace_id: 'b',
    });
    expect(workspace.workspace_id).toBe('b');
    expect(projectRoot).toBe('/b');
  });

  it('throws WorkspaceNotFoundError when workspace_id is unknown', async () => {
    const registry = await seeded([{ id: 'a', root: '/a' }]);
    expect(() =>
      resolveWorkspace(registry, { workspace_id: 'missing' }),
    ).toThrow(WorkspaceNotFoundError);
  });
});

describe('resolveWorkspace — active fallback', () => {
  it('uses the active workspace when workspace_id is absent', async () => {
    const registry = await seeded([
      { id: 'a', root: '/a' },
      { id: 'b', root: '/b' },
    ]);
    await registry.setActive('b');
    const { workspace, projectRoot } = resolveWorkspace(registry, {});
    expect(workspace.workspace_id).toBe('b');
    expect(projectRoot).toBe('/b');
  });

  it('throws NoActiveWorkspaceError when the registry is empty and workspace_id is absent', async () => {
    const registry = await seeded([]);
    expect(() => resolveWorkspace(registry, {})).toThrow(NoActiveWorkspaceError);
  });
});

describe('resolveWorkspace — explicit projectRoot', () => {
  it('returns projectRoot as-is when it matches the resolved workspace', async () => {
    const registry = await seeded([{ id: 'a', root: '/a' }]);
    const { projectRoot } = resolveWorkspace(registry, {
      workspace_id: 'a',
      projectRoot: '/a',
    });
    expect(projectRoot).toBe('/a');
  });

  it('throws WorkspaceRootMismatchError when projectRoot differs from the registered root', async () => {
    const registry = await seeded([{ id: 'a', root: '/a' }]);
    expect(() =>
      resolveWorkspace(registry, {
        workspace_id: 'a',
        projectRoot: '/different',
      }),
    ).toThrow(WorkspaceRootMismatchError);
  });

  it('throws WorkspaceRootMismatchError when projectRoot differs from active workspace', async () => {
    const registry = await seeded([{ id: 'a', root: '/a' }]);
    expect(() =>
      resolveWorkspace(registry, { projectRoot: '/different' }),
    ).toThrow(WorkspaceRootMismatchError);
  });
});
