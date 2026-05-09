/**
 * Tests for the `project.remove` MCP tool.
 */

import { describe, expect, it } from 'vitest';

import type { FileSystemAdapter } from '../../../src/projects/registry.js';
import { ProjectRegistry } from '../../../src/projects/registry.js';
import { removeWorkspace } from '../../../src/tools/project/remove.js';
import type { WorkspacesPersistence } from '../../../src/projects/persistence.js';

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

async function seeded(ids: ReadonlyArray<{ id: string; root: string }>, clocks: ReadonlyArray<string>): Promise<ProjectRegistry> {
  let i = 0;
  const fs = fakeFs(new Set(ids.map((x) => x.root)));
  const registry = new ProjectRegistry(
    memoryPersistence(),
    fs,
    () => clocks[i++]!,
  );
  for (const { id, root } of ids) {
    await registry.register({ workspace_id: id, projectRoot: root });
  }
  return registry;
}

describe('project.remove', () => {
  it('removes the workspace and returns removed + new active', async () => {
    const registry = await seeded(
      [
        { id: 'a', root: '/a' },
        { id: 'b', root: '/b' },
      ],
      [
        '2026-05-09T19:30:00.000Z',
        '2026-05-09T19:31:00.000Z',
      ],
    );
    const result = await removeWorkspace({ workspace_id: 'a' }, { registry });
    expect(result.removed?.workspace_id).toBe('a');
    expect(result.active_workspace_id).toBe('b');
  });

  it('returns removed: null for unknown ids', async () => {
    const registry = await seeded([], []);
    const result = await removeWorkspace(
      { workspace_id: 'missing' },
      { registry },
    );
    expect(result.removed).toBeNull();
    expect(result.active_workspace_id).toBeNull();
  });

  it('leaves active_workspace_id null when the last workspace is removed', async () => {
    const registry = await seeded(
      [{ id: 'a', root: '/a' }],
      ['2026-05-09T19:30:00.000Z'],
    );
    const result = await removeWorkspace({ workspace_id: 'a' }, { registry });
    expect(result.removed?.workspace_id).toBe('a');
    expect(result.active_workspace_id).toBeNull();
  });

  it('auto-promotes the newest remaining workspace when the active one is removed', async () => {
    const registry = await seeded(
      [
        { id: 'a', root: '/a' },
        { id: 'b', root: '/b' },
        { id: 'c', root: '/c' },
      ],
      [
        '2026-05-09T19:30:00.000Z',
        '2026-05-09T19:31:00.000Z',
        '2026-05-09T19:32:00.000Z',
      ],
    );
    await registry.setActive('a');
    const result = await removeWorkspace({ workspace_id: 'a' }, { registry });
    expect(result.active_workspace_id).toBe('c');
  });
});
