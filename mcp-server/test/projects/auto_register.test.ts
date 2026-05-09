/**
 * Tests for autoRegisterDefault().
 *
 * On startup the server tries to auto-register a workspace named
 * `"default"` whose `projectRoot` is `process.cwd()` (or an explicit
 * --cwd override). The function is a no-op if:
 *   - the registry already contains one or more workspaces, OR
 *   - the cwd is not an absolute path that contains project.godot.
 */

import { describe, expect, it } from 'vitest';

import { autoRegisterDefault } from '../../src/projects/auto_register.js';
import type { FileSystemAdapter } from '../../src/projects/registry.js';
import { ProjectRegistry } from '../../src/projects/registry.js';
import type {
  WorkspacesPersistence,
  WorkspacesSnapshot,
} from '../../src/projects/persistence.js';

function memoryPersistence(
  initial: WorkspacesSnapshot | null = null,
): WorkspacesPersistence {
  let current = initial;
  return {
    async read() {
      return current;
    },
    async write(snapshot) {
      current = snapshot;
    },
  };
}

function fakeFs(
  okRoots: ReadonlySet<string>,
  dirs: ReadonlySet<string> = okRoots,
): FileSystemAdapter {
  return {
    isAbsolute(p) {
      return p.startsWith('/');
    },
    async isDirectory(p) {
      return dirs.has(p);
    },
    async hasProjectGodot(p) {
      return okRoots.has(p);
    },
  };
}

describe('autoRegisterDefault', () => {
  it('registers a "default" workspace when cwd contains project.godot and the registry is empty', async () => {
    const fs = fakeFs(new Set(['/workspace']));
    const registry = new ProjectRegistry(
      memoryPersistence(),
      fs,
      () => '2026-05-09T19:30:00.000Z',
    );
    const ws = await autoRegisterDefault(registry, { cwd: '/workspace' });
    expect(ws).not.toBeNull();
    expect(ws?.workspace_id).toBe('default');
    expect(ws?.projectRoot).toBe('/workspace');
    expect(ws?.label).toBe('workspace');
    expect(ws?.active).toBe(true);
    expect(registry.getActive()?.workspace_id).toBe('default');
  });

  it('returns null when the registry already contains at least one workspace', async () => {
    const fs = fakeFs(new Set(['/a', '/workspace']));
    const registry = new ProjectRegistry(
      memoryPersistence(),
      fs,
      () => '2026-05-09T19:30:00.000Z',
    );
    await registry.register({ workspace_id: 'existing', projectRoot: '/a' });
    const result = await autoRegisterDefault(registry, { cwd: '/workspace' });
    expect(result).toBeNull();
    expect(registry.list().map((w) => w.workspace_id)).toEqual(['existing']);
  });

  it('returns null when cwd is not absolute', async () => {
    const fs = fakeFs(new Set());
    const registry = new ProjectRegistry(
      memoryPersistence(),
      fs,
      () => '2026-05-09T19:30:00.000Z',
    );
    const result = await autoRegisterDefault(registry, { cwd: 'relative/cwd' });
    expect(result).toBeNull();
    expect(registry.size()).toBe(0);
  });

  it('returns null when cwd does not contain project.godot', async () => {
    const fs = fakeFs(new Set(), new Set(['/not-a-project']));
    const registry = new ProjectRegistry(
      memoryPersistence(),
      fs,
      () => '2026-05-09T19:30:00.000Z',
    );
    const result = await autoRegisterDefault(registry, {
      cwd: '/not-a-project',
    });
    expect(result).toBeNull();
    expect(registry.size()).toBe(0);
  });

  it('envCwdOverride takes precedence over cwd', async () => {
    const fs = fakeFs(new Set(['/override']));
    const registry = new ProjectRegistry(
      memoryPersistence(),
      fs,
      () => '2026-05-09T19:30:00.000Z',
    );
    const result = await autoRegisterDefault(registry, {
      cwd: '/ignored',
      envCwdOverride: '/override',
    });
    expect(result?.projectRoot).toBe('/override');
    expect(result?.label).toBe('override');
  });
});
