/**
 * Tests for the `project.switch` MCP tool.
 */

import { describe, expect, it } from 'vitest';

import type { FileSystemAdapter } from '../../../src/projects/registry.js';
import { ProjectRegistry } from '../../../src/projects/registry.js';
import { WorkspaceNotFoundError } from '../../../src/projects/errors.js';
import { switchWorkspace } from '../../../src/tools/project/switch.js';
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

describe('project.switch', () => {
  it('switches the active workspace and returns previous + new ids', async () => {
    const registry = await seeded([
      { id: 'a', root: '/a' },
      { id: 'b', root: '/b' },
    ]);
    // 'a' is active after the first register.
    const result = await switchWorkspace({ workspace_id: 'b' }, { registry });
    expect(result).toEqual({
      previous_workspace_id: 'a',
      active_workspace_id: 'b',
    });
    expect(registry.getActive()?.workspace_id).toBe('b');
  });

  it('is idempotent on self-switch', async () => {
    const registry = await seeded([{ id: 'a', root: '/a' }]);
    const result = await switchWorkspace({ workspace_id: 'a' }, { registry });
    expect(result).toEqual({
      previous_workspace_id: 'a',
      active_workspace_id: 'a',
    });
  });

  it('throws WorkspaceNotFoundError for unknown ids', async () => {
    const registry = await seeded([]);
    await expect(
      switchWorkspace({ workspace_id: 'missing' }, { registry }),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });
});
