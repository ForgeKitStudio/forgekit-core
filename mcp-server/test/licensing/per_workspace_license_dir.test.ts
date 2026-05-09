/**
 * Cross-subsystem integration test: per-workspace license resolution.
 *
 * The dispatcher middleware resolves `projectRoot` from the caller's
 * `workspace_id`; the licensing layer takes that `projectRoot` and
 * produces a per-workspace `user://licenses/` mirror path. This test
 * demonstrates that two workspaces with distinct `projectRoot` values
 * resolve to distinct license directories, which is how per-project
 * profile filtering (unlocked modules) gets isolated.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FileSystemAdapter } from '../../src/projects/registry.js';
import { ProjectRegistry } from '../../src/projects/registry.js';
import { resolveLicenseDir } from '../../src/licensing/startup.js';
import { resolveWorkspace } from '../../src/projects/resolve_workspace.js';
import type { WorkspacesPersistence } from '../../src/projects/persistence.js';

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

let clientAHome: string;
let clientBHome: string;

beforeEach(async () => {
  clientAHome = await mkdtemp(join(tmpdir(), 'forgekit-licA-'));
  clientBHome = await mkdtemp(join(tmpdir(), 'forgekit-licB-'));
});

afterEach(async () => {
  await rm(clientAHome, { recursive: true, force: true });
  await rm(clientBHome, { recursive: true, force: true });
});

describe('per-workspace licensing resolution', () => {
  it('two workspaces with distinct projectRoot yield distinct license dirs', async () => {
    // Stage each workspace's project.godot with a unique config/name so
    // resolveLicenseDir can pull a project-specific name into the Godot
    // user:// path.
    const rootA = join(clientAHome, 'client-a');
    const rootB = join(clientBHome, 'client-b');
    await mkdir(rootA, { recursive: true });
    await mkdir(rootB, { recursive: true });
    await writeFile(
      join(rootA, 'project.godot'),
      'config_version=5\n[application]\nconfig/name="ClientA"\n',
      'utf8',
    );
    await writeFile(
      join(rootB, 'project.godot'),
      'config_version=5\n[application]\nconfig/name="ClientB"\n',
      'utf8',
    );

    // Register two workspaces pointing at the two roots.
    const fs = fakeFs(new Set([rootA, rootB]));
    const registry = new ProjectRegistry(
      memoryPersistence(),
      fs,
      () => '2026-05-09T19:30:00.000Z',
    );
    await registry.register({ workspace_id: 'a', projectRoot: rootA });
    await registry.register({ workspace_id: 'b', projectRoot: rootB });

    // Dispatcher middleware resolves each request to the right projectRoot.
    const resolvedA = resolveWorkspace(registry, { workspace_id: 'a' });
    const resolvedB = resolveWorkspace(registry, { workspace_id: 'b' });
    expect(resolvedA.projectRoot).toBe(rootA);
    expect(resolvedB.projectRoot).toBe(rootB);

    // Feed each projectRoot into the licensing resolver. The two
    // directories must differ — that is how profile unlock isolation
    // per workspace is achieved.
    const homedir = '/home/test-user';
    const dirA = await resolveLicenseDir({
      projectRoot: resolvedA.projectRoot,
      platform: 'linux',
      env: {},
      homedir,
    });
    const dirB = await resolveLicenseDir({
      projectRoot: resolvedB.projectRoot,
      platform: 'linux',
      env: {},
      homedir,
    });
    expect(dirA).not.toBe(dirB);
    expect(dirA).toContain('ClientA');
    expect(dirB).toContain('ClientB');
    expect(dirA.endsWith('licenses')).toBe(true);
    expect(dirB.endsWith('licenses')).toBe(true);
  });
});
