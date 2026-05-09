/**
 * CLI handler for the `forgekit-mcp install-hooks` subcommand.
 *
 * Discovers the repository's `.git` directory via `git rev-parse --git-dir`
 * and its working tree root via `git rev-parse --show-toplevel`, then
 * delegates to {@link installHooks} from `scripts/git-hooks/install.ts` to
 * write the `commit-msg` / `pre-commit` shims.
 *
 * The module exports a `runInstallHooks(argv, deps)` entrypoint with
 * dependency injection so the routing in `src/index.ts` (and its tests) can
 * stub out `exec`, the installer call, the target-path resolver and the
 * stderr writer.
 */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { promisify } from 'node:util';

import {
  installHooks as defaultInstallHooks,
  type InstallHooksOptions,
  type InstallHooksResult,
} from '../../scripts/git-hooks/install.js';

const execFileAsync = promisify(execFile);

/** Paths to the compiled hook scripts inside this package. */
export interface HookTargets {
  commitMsgTarget: string;
  preCommitTarget: string;
}

/** Dependencies accepted by {@link runInstallHooks}. All are optional in the
 * production entrypoint but fully specified in tests. */
export interface InstallHooksDeps {
  exec: (cmd: string, args: readonly string[]) => Promise<string>;
  installHooks: (opts: InstallHooksOptions) => Promise<InstallHooksResult>;
  resolveHookTargets: () => HookTargets;
  writeStderr: (chunk: string) => void;
}

/**
 * Resolve the compiled `commit-msg.js` and `pre-commit.js` scripts relative
 * to this module's location. In production they live at
 * `<package>/dist/scripts/git-hooks/*.js`; this file, once compiled, is at
 * `<package>/dist/src/cli/install_hooks.js`, so we walk up to `dist/` via
 * two `..` segments.
 */
function defaultResolveHookTargets(): HookTargets {
  const here = dirname(fileURLToPath(import.meta.url));
  const gitHooksDir = resolvePath(here, '..', '..', 'scripts', 'git-hooks');
  return {
    commitMsgTarget: resolvePath(gitHooksDir, 'commit-msg.js'),
    preCommitTarget: resolvePath(gitHooksDir, 'pre-commit.js'),
  };
}

/**
 * Build the production-default deps object. Tests pass a fully-specified
 * {@link InstallHooksDeps}; production uses these defaults.
 */
export function defaultInstallHooksDeps(): InstallHooksDeps {
  return {
    exec: async (cmd, args) => {
      const { stdout } = await execFileAsync(cmd, [...args], {
        maxBuffer: 4 * 1024 * 1024,
      });
      return stdout.toString();
    },
    installHooks: (opts) => defaultInstallHooks(opts),
    resolveHookTargets: defaultResolveHookTargets,
    writeStderr: (chunk) => process.stderr.write(chunk),
  };
}

/**
 * Entry point for the `install-hooks` subcommand. Returns a process exit
 * code; the caller (main) is responsible for `process.exit`.
 */
export async function runInstallHooks(
  _argv: readonly string[],
  deps: InstallHooksDeps = defaultInstallHooksDeps(),
): Promise<number> {
  let gitDir: string;
  let repoRoot: string;
  try {
    gitDir = (await deps.exec('git', ['rev-parse', '--git-dir'])).trim();
    repoRoot = (await deps.exec('git', ['rev-parse', '--show-toplevel'])).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.writeStderr(
      `[@forgekitstudio/core-mcp] install-hooks: could not resolve git directory — ${message}\n`,
    );
    return 1;
  }

  const { commitMsgTarget, preCommitTarget } = deps.resolveHookTargets();

  // If `git rev-parse --git-dir` returned a relative path (the default inside
  // a working tree), re-anchor it to the repo root so our absolute paths are
  // meaningful.
  const absoluteGitDir = gitDir.startsWith('/') ? gitDir : resolvePath(repoRoot, gitDir);

  try {
    const result = await deps.installHooks({
      gitDir: absoluteGitDir,
      repoRoot,
      commitMsgTarget,
      preCommitTarget,
    });
    deps.writeStderr(
      `[@forgekitstudio/core-mcp] installed git hooks → ${result.installed.join(', ')}\n`,
    );
    if (result.backedUp.length > 0) {
      deps.writeStderr(
        `[@forgekitstudio/core-mcp] backed up previous hooks: ${result.backedUp.join(', ')}\n`,
      );
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.writeStderr(
      `[@forgekitstudio/core-mcp] install-hooks: installation failed — ${message}\n`,
    );
    return 1;
  }
}
