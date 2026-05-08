/**
 * Tests for `resolveCoreVersionFromGit`.
 *
 * The resolver sources the Core version from the Core repository's git
 * tag (`vX.Y.Z`) rather than an in-memory value so that the comparison
 * performed by `modules.check_compatibility` cannot drift from the
 * actual Core code on disk.
 *
 * `runGit` is injected so the unit tests stay hermetic. A final
 * integration test exercises the default runner against a real throw-
 * away git repository under `os.tmpdir()`; it is skipped if `git` is
 * not available on the host.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CoreVersionUnavailableError } from '../../../src/tools/modules/errors.js';
import {
  resetCoreVersionCache,
  resolveCoreVersionFromGit,
  type RunGit,
} from '../../../src/tools/modules/core_version.js';

afterEach(() => {
  resetCoreVersionCache();
});

describe('resolveCoreVersionFromGit — happy path', () => {
  it('returns the git tag with the leading "v" stripped', async () => {
    const runGit: RunGit = vi.fn().mockResolvedValue({
      stdout: 'v1.2.3\n',
      stderr: '',
      exitCode: 0,
    });
    const result = await resolveCoreVersionFromGit({
      projectRoot: '/tmp/forgekit-core',
      runGit,
    });
    expect(result).toBe('1.2.3');
  });

  it('invokes git with -C <projectRoot> describe --tags --abbrev=0 --match v*.*.*', async () => {
    const runGit: RunGit = vi.fn().mockResolvedValue({
      stdout: 'v0.1.0\n',
      stderr: '',
      exitCode: 0,
    });
    await resolveCoreVersionFromGit({
      projectRoot: '/repo',
      runGit,
    });
    expect(runGit).toHaveBeenCalledTimes(1);
    const [args, opts] = (runGit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args).toEqual([
      '-C',
      '/repo',
      'describe',
      '--tags',
      '--abbrev=0',
      '--match',
      'v[0-9]*.[0-9]*.[0-9]*',
    ]);
    expect(opts).toEqual({ cwd: '/repo' });
  });

  it('tolerates tags without a leading "v"', async () => {
    const runGit: RunGit = vi.fn().mockResolvedValue({
      stdout: '2.0.0\n',
      stderr: '',
      exitCode: 0,
    });
    const result = await resolveCoreVersionFromGit({
      projectRoot: '/tmp/p',
      runGit,
    });
    expect(result).toBe('2.0.0');
  });
});

describe('resolveCoreVersionFromGit — caching', () => {
  it('does not re-invoke runGit on a second call for the same projectRoot', async () => {
    const runGit: RunGit = vi.fn().mockResolvedValue({
      stdout: 'v1.0.0\n',
      stderr: '',
      exitCode: 0,
    });
    const first = await resolveCoreVersionFromGit({
      projectRoot: '/tmp/cached',
      runGit,
    });
    const second = await resolveCoreVersionFromGit({
      projectRoot: '/tmp/cached',
      runGit,
    });
    expect(first).toBe('1.0.0');
    expect(second).toBe('1.0.0');
    expect(runGit).toHaveBeenCalledTimes(1);
  });

  it('caches per projectRoot — different roots are resolved independently', async () => {
    const runGit: RunGit = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'v1.0.0\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'v2.0.0\n', stderr: '', exitCode: 0 });
    const a = await resolveCoreVersionFromGit({
      projectRoot: '/tmp/a',
      runGit,
    });
    const b = await resolveCoreVersionFromGit({
      projectRoot: '/tmp/b',
      runGit,
    });
    expect(a).toBe('1.0.0');
    expect(b).toBe('2.0.0');
    expect(runGit).toHaveBeenCalledTimes(2);
  });

  it('resetCoreVersionCache() forces a fresh resolution', async () => {
    const runGit: RunGit = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'v1.0.0\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'v1.1.0\n', stderr: '', exitCode: 0 });
    const first = await resolveCoreVersionFromGit({
      projectRoot: '/tmp/reset',
      runGit,
    });
    resetCoreVersionCache();
    const second = await resolveCoreVersionFromGit({
      projectRoot: '/tmp/reset',
      runGit,
    });
    expect(first).toBe('1.0.0');
    expect(second).toBe('1.1.0');
    expect(runGit).toHaveBeenCalledTimes(2);
  });
});

describe('resolveCoreVersionFromGit — failure modes', () => {
  it('throws CoreVersionUnavailableError on non-zero exit', async () => {
    const runGit: RunGit = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'fatal: No names found, cannot describe anything.\n',
      exitCode: 128,
    });
    await expect(
      resolveCoreVersionFromGit({ projectRoot: '/tmp/no-tags', runGit }),
    ).rejects.toBeInstanceOf(CoreVersionUnavailableError);
  });

  it('propagates git_stderr in the error data on non-zero exit', async () => {
    const runGit: RunGit = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'fatal: not a git repository\n',
      exitCode: 128,
    });
    try {
      await resolveCoreVersionFromGit({ projectRoot: '/tmp/no-repo', runGit });
      expect.fail('expected CoreVersionUnavailableError');
    } catch (err) {
      expect(err).toBeInstanceOf(CoreVersionUnavailableError);
      const e = err as CoreVersionUnavailableError;
      expect(e.code).toBe(-32008);
      expect(e.data.reason).toBe('git_describe_failed');
      expect(e.data.git_stderr).toContain('not a git repository');
    }
  });

  it('throws CoreVersionUnavailableError when stdout is empty on a zero exit', async () => {
    const runGit: RunGit = vi.fn().mockResolvedValue({
      stdout: '   \n',
      stderr: '',
      exitCode: 0,
    });
    await expect(
      resolveCoreVersionFromGit({ projectRoot: '/tmp/empty', runGit }),
    ).rejects.toBeInstanceOf(CoreVersionUnavailableError);
  });

  it('does NOT cache a failed resolution (next call retries)', async () => {
    const runGit: RunGit = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'fatal: No names found\n',
        exitCode: 128,
      })
      .mockResolvedValueOnce({
        stdout: 'v1.0.0\n',
        stderr: '',
        exitCode: 0,
      });
    await expect(
      resolveCoreVersionFromGit({ projectRoot: '/tmp/retry', runGit }),
    ).rejects.toBeInstanceOf(CoreVersionUnavailableError);
    const second = await resolveCoreVersionFromGit({
      projectRoot: '/tmp/retry',
      runGit,
    });
    expect(second).toBe('1.0.0');
    expect(runGit).toHaveBeenCalledTimes(2);
  });
});

describe('resolveCoreVersionFromGit — integration (real git)', () => {
  const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  const testIf = hasGit ? it : it.skip;

  testIf(
    'resolves the latest tag against a freshly-initialised git repo',
    async () => {
      const repo = await mkdtemp(join(tmpdir(), 'forgekit-core-git-'));
      try {
        const run = (args: string[]) =>
          spawnSync('git', args, { cwd: repo, encoding: 'utf8' });

        // Minimal repo configuration so the committer identity and
        // default branch do not depend on the host's global git config.
        expect(run(['init', '-q', '-b', 'main']).status).toBe(0);
        expect(run(['config', 'user.email', 'ci@forgekit.test']).status).toBe(0);
        expect(run(['config', 'user.name', 'ForgeKit CI']).status).toBe(0);
        expect(run(['config', 'commit.gpgsign', 'false']).status).toBe(0);

        await writeFile(join(repo, 'README.md'), '# test\n', 'utf8');
        expect(run(['add', 'README.md']).status).toBe(0);
        expect(run(['commit', '-q', '-m', 'initial']).status).toBe(0);
        expect(
          run(['tag', '-a', 'v0.4.2', '-m', 'release 0.4.2']).status,
        ).toBe(0);

        const version = await resolveCoreVersionFromGit({ projectRoot: repo });
        expect(version).toBe('0.4.2');
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
