/**
 * Tests for the `project.get_active` MCP tool.
 */

import { describe, expect, it } from 'vitest';

import type { FileSystemAdapter } from '../../../src/projects/registry.js';
import { ProjectRegistry } from '../../../src/projects/registry.js';
import { getActiveWorkspace } from '../../../src/tools/project/get_active.js';
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

describe('project.get_active', () => {
  it('returns {active_workspace_id: null, workspace: null} for empty registry', async () => {
    const registry = new ProjectRegistry(
      memoryPersistence(),
      fakeFs(new Set()),
    );
    const result = await getActiveWorkspace({}, { registry });
    expect(result).toEqual({ active_workspace_id: null, workspace: null });
  });

  it('returns the active workspace when one is registered', async () => {
    const registry = new ProjectRegistry(
      memoryPersistence(),
      fakeFs(new Set(['/a'])),
      () => '2026-05-09T19:30:00.000Z',
    );
    await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    const result = await getActiveWorkspace({}, { registry });
    expect(result.active_workspace_id).toBe('a');
    expect(result.workspace?.workspace_id).toBe('a');
  });
});
