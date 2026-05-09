/**
 * Tests for the `project.list_workspaces` MCP tool.
 *
 * The handler is a thin read-only shim over ProjectRegistry.list() and
 * getActive(). The shape of the result matches the documented
 * `{workspaces, active_workspace_id, limit: 32}` contract.
 */

import { describe, expect, it } from 'vitest';

import type { FileSystemAdapter } from '../../../src/projects/registry.js';
import { ProjectRegistry } from '../../../src/projects/registry.js';
import { listWorkspaces } from '../../../src/tools/project/list_workspaces.js';
import type { WorkspacesPersistence } from '../../../src/projects/persistence.js';
import { MAX_WORKSPACES } from '../../../src/projects/workspace.js';

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

function fakeFs(roots: ReadonlySet<string>): FileSystemAdapter {
  return {
    isAbsolute: (p) => p.startsWith('/'),
    isDirectory: async (p) => roots.has(p),
    hasProjectGodot: async (p) => roots.has(p),
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

describe('project.list_workspaces', () => {
  it('returns an empty list + null active for an empty registry', async () => {
    const registry = await seeded([]);
    const result = await listWorkspaces({}, { registry });
    expect(result).toEqual({
      workspaces: [],
      active_workspace_id: null,
      limit: MAX_WORKSPACES,
    });
  });

  it('returns workspaces sorted by workspace_id and surfaces the active one', async () => {
    const registry = await seeded([
      { id: 'client-b', root: '/b' },
      { id: 'client-a', root: '/a' },
    ]);
    const result = await listWorkspaces({}, { registry });
    expect(result.workspaces.map((w) => w.workspace_id)).toEqual([
      'client-a',
      'client-b',
    ]);
    expect(result.active_workspace_id).toBe('client-b');
    expect(result.limit).toBe(MAX_WORKSPACES);
  });
});
