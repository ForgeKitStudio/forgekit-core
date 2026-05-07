/**
 * Unit tests for the installer that writes `commit-msg` and `pre-commit`
 * shim scripts into `.git/hooks/`.
 *
 * The installer must be idempotent, must back up a pre-existing third-party
 * hook (recognised by the absence of ForgeKit's marker comment), and must
 * overwrite an existing ForgeKit shim in place.
 */

import { describe, expect, it } from 'vitest';

import {
  FORGEKIT_SHIM_MARKER,
  installHooks,
  type InstallerFs,
} from '../scripts/git-hooks/install.js';

interface FakeFsState {
  files: Map<string, string>;
  dirs: Set<string>;
  chmods: Array<{ path: string; mode: number }>;
  renames: Array<{ from: string; to: string }>;
}

function makeFakeFs(initial: Record<string, string> = {}): {
  fs: InstallerFs;
  state: FakeFsState;
} {
  const state: FakeFsState = {
    files: new Map(Object.entries(initial)),
    dirs: new Set(),
    chmods: [],
    renames: [],
  };

  const fs: InstallerFs = {
    async readFile(path) {
      const content = state.files.get(path);
      if (content === undefined) {
        const err = new Error(`ENOENT: ${path}`) as Error & { code?: string };
        err.code = 'ENOENT';
        throw err;
      }
      return content;
    },
    async writeFile(path, chunk) {
      state.files.set(path, chunk);
    },
    async rename(from, to) {
      const content = state.files.get(from);
      if (content === undefined) {
        throw new Error(`ENOENT: ${from}`);
      }
      state.files.delete(from);
      state.files.set(to, content);
      state.renames.push({ from, to });
    },
    async chmod(path, mode) {
      state.chmods.push({ path, mode });
    },
    async mkdir(path) {
      state.dirs.add(path);
    },
    async stat(path) {
      return state.files.has(path);
    },
  };

  return { fs, state };
}

const FIXED_DATE = new Date('2025-06-07T08:09:10.000Z');

describe('installHooks — fresh install', () => {
  it('writes both shim scripts with shebang and exec-node commands', async () => {
    const { fs, state } = makeFakeFs();
    const result = await installHooks({
      gitDir: '/repo/.git',
      repoRoot: '/repo',
      commitMsgTarget: '/repo/mcp-server/dist/scripts/git-hooks/commit-msg.js',
      preCommitTarget: '/repo/mcp-server/dist/scripts/git-hooks/pre-commit.js',
      fs,
      now: () => FIXED_DATE,
      platform: 'linux',
    });

    expect(result.installed.sort()).toEqual([
      '/repo/.git/hooks/commit-msg',
      '/repo/.git/hooks/pre-commit',
    ]);
    expect(result.backedUp).toEqual([]);

    const commitMsgShim = state.files.get('/repo/.git/hooks/commit-msg');
    const preCommitShim = state.files.get('/repo/.git/hooks/pre-commit');
    expect(commitMsgShim).toBeDefined();
    expect(preCommitShim).toBeDefined();
    for (const shim of [commitMsgShim, preCommitShim]) {
      expect(shim!.startsWith('#!/usr/bin/env sh\n')).toBe(true);
      expect(shim).toContain(FORGEKIT_SHIM_MARKER);
      expect(shim).toContain('exec node ');
    }
    expect(commitMsgShim).toContain('mcp-server/dist/scripts/git-hooks/commit-msg.js');
    expect(preCommitShim).toContain('mcp-server/dist/scripts/git-hooks/pre-commit.js');
  });

  it('chmods both shims to 0o755 on POSIX', async () => {
    const { fs, state } = makeFakeFs();
    await installHooks({
      gitDir: '/repo/.git',
      repoRoot: '/repo',
      commitMsgTarget: '/repo/mcp-server/dist/scripts/git-hooks/commit-msg.js',
      preCommitTarget: '/repo/mcp-server/dist/scripts/git-hooks/pre-commit.js',
      fs,
      now: () => FIXED_DATE,
      platform: 'linux',
    });

    const chmodPaths = state.chmods.map((c) => c.path).sort();
    expect(chmodPaths).toEqual([
      '/repo/.git/hooks/commit-msg',
      '/repo/.git/hooks/pre-commit',
    ]);
    for (const c of state.chmods) {
      expect(c.mode).toBe(0o755);
    }
  });

  it('skips chmod on Windows', async () => {
    const { fs, state } = makeFakeFs();
    await installHooks({
      gitDir: '/repo/.git',
      repoRoot: '/repo',
      commitMsgTarget: '/repo/mcp-server/dist/scripts/git-hooks/commit-msg.js',
      preCommitTarget: '/repo/mcp-server/dist/scripts/git-hooks/pre-commit.js',
      fs,
      now: () => FIXED_DATE,
      platform: 'win32',
    });
    expect(state.chmods).toEqual([]);
  });
});

describe('installHooks — pre-existing hooks', () => {
  it('backs up a third-party hook by renaming with a timestamp suffix', async () => {
    const { fs, state } = makeFakeFs({
      '/repo/.git/hooks/commit-msg': '#!/bin/sh\necho other tool\n',
    });
    const warnings: string[] = [];

    const result = await installHooks({
      gitDir: '/repo/.git',
      repoRoot: '/repo',
      commitMsgTarget: '/repo/mcp-server/dist/scripts/git-hooks/commit-msg.js',
      preCommitTarget: '/repo/mcp-server/dist/scripts/git-hooks/pre-commit.js',
      fs,
      now: () => FIXED_DATE,
      platform: 'linux',
      logger: { warn: (m) => warnings.push(m) },
    });

    expect(warnings.some((w) => w.includes('commit-msg'))).toBe(true);

    expect(result.backedUp).toEqual([
      '/repo/.git/hooks/commit-msg.backup-20250607T080910000Z',
    ]);
    expect(state.renames).toEqual([
      {
        from: '/repo/.git/hooks/commit-msg',
        to: '/repo/.git/hooks/commit-msg.backup-20250607T080910000Z',
      },
    ]);
    const newShim = state.files.get('/repo/.git/hooks/commit-msg');
    expect(newShim).toContain(FORGEKIT_SHIM_MARKER);
  });

  it('overwrites an existing ForgeKit shim without backing it up', async () => {
    const stale = `#!/usr/bin/env sh\n${FORGEKIT_SHIM_MARKER}\nexec node /old/path.js "$@"\n`;
    const { fs, state } = makeFakeFs({
      '/repo/.git/hooks/pre-commit': stale,
    });

    const result = await installHooks({
      gitDir: '/repo/.git',
      repoRoot: '/repo',
      commitMsgTarget: '/repo/mcp-server/dist/scripts/git-hooks/commit-msg.js',
      preCommitTarget: '/repo/mcp-server/dist/scripts/git-hooks/pre-commit.js',
      fs,
      now: () => FIXED_DATE,
      platform: 'linux',
    });

    expect(result.backedUp).toEqual([]);
    expect(state.renames).toEqual([]);
    const newShim = state.files.get('/repo/.git/hooks/pre-commit');
    expect(newShim).toContain(FORGEKIT_SHIM_MARKER);
    expect(newShim).toContain('mcp-server/dist/scripts/git-hooks/pre-commit.js');
    expect(newShim).not.toContain('/old/path.js');
  });
});
