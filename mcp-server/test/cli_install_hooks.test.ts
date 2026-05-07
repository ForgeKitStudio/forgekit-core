/**
 * Integration-light tests for the `forgekit-mcp install-hooks` subcommand.
 *
 * Verifies:
 *   - Existing flag-based invocations (parseCliArgs, main) continue to work.
 *   - A `['install-hooks']` argv is detected by `main` and routed to the
 *     install-hooks handler.
 *   - The install-hooks handler resolves the git directory via `git
 *     rev-parse` and calls `installHooks` with the expected arguments.
 */

import { describe, expect, it } from 'vitest';

import { main, parseCliArgs } from '../src/index.js';
import { runInstallHooks, type InstallHooksDeps } from '../src/cli/install_hooks.js';

describe('parseCliArgs — regression (existing behaviour)', () => {
  it('returns defaults when argv is empty', () => {
    expect(parseCliArgs([])).toEqual({
      stdio: false,
      profile: 'Full',
      logLevel: 'info',
    });
  });

  it('still recognises --stdio', () => {
    expect(parseCliArgs(['--stdio']).stdio).toBe(true);
  });
});

describe('main — install-hooks routing', () => {
  it('delegates to the install handler when argv[0] is "install-hooks"', async () => {
    const calls: Array<readonly string[]> = [];
    let ran = false;
    const fakeHandler = async (argv: readonly string[]): Promise<number> => {
      calls.push(argv);
      ran = true;
      return 0;
    };

    const exitCode = await main(['install-hooks', '--verbose'], {
      installHooksHandler: fakeHandler,
    });

    expect(ran).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['--verbose']);
    expect(exitCode).toBe(0);
  });

  it('does not invoke the install handler for flag-only argv', async () => {
    let ran = false;
    const fakeHandler = async (): Promise<number> => {
      ran = true;
      return 0;
    };

    const exitCode = await main([], {
      installHooksHandler: fakeHandler,
    });

    expect(ran).toBe(false);
    expect(exitCode).toBe(0);
  });
});

describe('runInstallHooks — resolves git dir and calls installer', () => {
  it('passes the resolved gitDir, repoRoot and compiled-script paths to installHooks', async () => {
    const execCalls: Array<{ cmd: string; args: readonly string[] }> = [];
    const installCalls: Array<Record<string, unknown>> = [];

    const deps: InstallHooksDeps = {
      async exec(cmd, args) {
        execCalls.push({ cmd, args: [...args] });
        if (args[0] === 'rev-parse' && args[1] === '--git-dir') {
          return '/repo/.git\n';
        }
        if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
          return '/repo\n';
        }
        throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
      },
      async installHooks(opts) {
        installCalls.push(opts as unknown as Record<string, unknown>);
        return { installed: ['/repo/.git/hooks/commit-msg', '/repo/.git/hooks/pre-commit'], backedUp: [] };
      },
      resolveHookTargets: () => ({
        commitMsgTarget: '/node_modules/@forgekit/core-mcp/dist/scripts/git-hooks/commit-msg.js',
        preCommitTarget: '/node_modules/@forgekit/core-mcp/dist/scripts/git-hooks/pre-commit.js',
      }),
      writeStderr: () => {},
    };

    const code = await runInstallHooks([], deps);

    expect(code).toBe(0);
    expect(execCalls.some((c) => c.args.join(' ') === 'rev-parse --git-dir')).toBe(true);
    expect(execCalls.some((c) => c.args.join(' ') === 'rev-parse --show-toplevel')).toBe(true);
    expect(installCalls).toHaveLength(1);
    const opts = installCalls[0];
    expect(opts.gitDir).toBe('/repo/.git');
    expect(opts.repoRoot).toBe('/repo');
    expect(opts.commitMsgTarget).toBe(
      '/node_modules/@forgekit/core-mcp/dist/scripts/git-hooks/commit-msg.js',
    );
    expect(opts.preCommitTarget).toBe(
      '/node_modules/@forgekit/core-mcp/dist/scripts/git-hooks/pre-commit.js',
    );
  });

  it('prints a success summary to stderr and returns zero', async () => {
    const stderrChunks: string[] = [];
    const deps: InstallHooksDeps = {
      async exec(_cmd, args) {
        if (args[0] === 'rev-parse' && args[1] === '--git-dir') {
          return '/repo/.git\n';
        }
        if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
          return '/repo\n';
        }
        throw new Error('unexpected');
      },
      async installHooks() {
        return {
          installed: ['/repo/.git/hooks/commit-msg', '/repo/.git/hooks/pre-commit'],
          backedUp: [],
        };
      },
      resolveHookTargets: () => ({
        commitMsgTarget: '/compiled/commit-msg.js',
        preCommitTarget: '/compiled/pre-commit.js',
      }),
      writeStderr: (chunk) => stderrChunks.push(chunk),
    };

    const code = await runInstallHooks([], deps);
    expect(code).toBe(0);
    const out = stderrChunks.join('');
    expect(out).toContain('[@forgekit/core-mcp]');
    expect(out).toContain('commit-msg');
    expect(out).toContain('pre-commit');
  });

  it('returns non-zero when git rev-parse fails (not in a git repo)', async () => {
    const stderrChunks: string[] = [];
    const deps: InstallHooksDeps = {
      async exec() {
        throw new Error('fatal: not a git repository');
      },
      async installHooks() {
        throw new Error('should not be called');
      },
      resolveHookTargets: () => ({
        commitMsgTarget: '/x/commit-msg.js',
        preCommitTarget: '/x/pre-commit.js',
      }),
      writeStderr: (chunk) => stderrChunks.push(chunk),
    };

    const code = await runInstallHooks([], deps);
    expect(code).not.toBe(0);
    expect(stderrChunks.join('')).toContain('not a git repository');
  });
});
