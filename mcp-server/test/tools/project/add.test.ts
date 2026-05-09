/**
 * Tests for the `project.add` MCP tool.
 */

import { describe, expect, it } from 'vitest';

import type { FileSystemAdapter } from '../../../src/projects/registry.js';
import { ProjectRegistry } from '../../../src/projects/registry.js';
import {
  WorkspaceAlreadyRegisteredError,
} from '../../../src/projects/errors.js';
import { addWorkspace } from '../../../src/tools/project/add.js';
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

function buildRegistry(roots: ReadonlyArray<string>): ProjectRegistry {
  return new ProjectRegistry(
    memoryPersistence(),
    fakeFs(new Set(roots)),
    () => '2026-05-09T19:30:00.000Z',
  );
}

describe('project.add', () => {
  it('registers a workspace and returns it', async () => {
    const registry = buildRegistry(['/a']);
    const result = await addWorkspace(
      { workspace_id: 'a', projectRoot: '/a', label: 'A' },
      { registry },
    );
    expect(result.workspace.workspace_id).toBe('a');
    expect(result.workspace.projectRoot).toBe('/a');
    expect(result.workspace.label).toBe('A');
    expect(registry.size()).toBe(1);
  });

  it('honours make_active=true by switching the active workspace', async () => {
    const registry = buildRegistry(['/a', '/b']);
    await addWorkspace(
      { workspace_id: 'a', projectRoot: '/a' },
      { registry },
    );
    const result = await addWorkspace(
      {
        workspace_id: 'b',
        projectRoot: '/b',
        make_active: true,
      },
      { registry },
    );
    expect(result.workspace.workspace_id).toBe('b');
    expect(registry.getActive()?.workspace_id).toBe('b');
  });

  it('is idempotent for re-add with the same fields', async () => {
    const registry = buildRegistry(['/a']);
    const first = await addWorkspace(
      { workspace_id: 'a', projectRoot: '/a', label: 'A' },
      { registry },
    );
    const second = await addWorkspace(
      { workspace_id: 'a', projectRoot: '/a', label: 'A' },
      { registry },
    );
    expect(second.workspace).toEqual(first.workspace);
    expect(registry.size()).toBe(1);
  });

  it('throws WorkspaceAlreadyRegisteredError when fields differ on re-add', async () => {
    const registry = buildRegistry(['/a', '/b']);
    await addWorkspace(
      { workspace_id: 'a', projectRoot: '/a' },
      { registry },
    );
    await expect(
      addWorkspace(
        { workspace_id: 'a', projectRoot: '/b' },
        { registry },
      ),
    ).rejects.toBeInstanceOf(WorkspaceAlreadyRegisteredError);
  });
});
