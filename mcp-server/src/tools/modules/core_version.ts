/**
 * Resolves the Core version from the Core repository's git tag so that
 * `modules.check_compatibility` compares `manifest.core_min_version`
 * against the version of the Core code actually on disk at
 * `projectRoot`, not an in-memory value that can drift from the files.
 *
 * The default runner shells out to:
 *
 *   git -C <projectRoot> describe --tags --abbrev=0 --match "v[0-9]*.[0-9]*.[0-9]*"
 *
 * and strips the leading `v`. `runGit` is pluggable so unit tests stay
 * hermetic and a separate integration test exercises the default path
 * against a throw-away real git repository.
 *
 * Successful resolutions are memoised per `projectRoot` for the
 * lifetime of the process; failed resolutions are not cached so a
 * transient git outage does not become sticky. `resetCoreVersionCache`
 * exists for tests and for long-running dispatchers that need to
 * forget a stale tag after a `git fetch`.
 */

import { spawn } from 'node:child_process';

import { CoreVersionUnavailableError } from './errors.js';

/** Output shape of an invocation of the injected git runner. */
export interface RunGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Signature of the injected git runner. */
export type RunGit = (
  args: readonly string[],
  opts: { cwd: string },
) => Promise<RunGitResult>;

export interface ResolveCoreVersionParams {
  projectRoot: string;
  /** Optional dependency injection point; defaults to `defaultRunGit`. */
  runGit?: RunGit;
}

/**
 * Default git runner: spawns `git` with the given args and collects
 * stdout/stderr into strings. Mirrors `defaultSpawnGodot`'s conventions
 * so the two helpers behave identically from the caller's point of
 * view (exit code `null` from a signal-killed child is surfaced as
 * `-1`).
 */
export const defaultRunGit: RunGit = (args, opts) => {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...args], {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<string>>();

/** Clears the per-process cache. Intended for tests. */
export function resetCoreVersionCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveCoreVersionFromGit(
  params: ResolveCoreVersionParams,
): Promise<string> {
  const { projectRoot } = params;
  const runGit = params.runGit ?? defaultRunGit;

  const cached = cache.get(projectRoot);
  if (cached !== undefined) {
    return cached;
  }

  const pending = runResolve(projectRoot, runGit);
  cache.set(projectRoot, pending);
  try {
    return await pending;
  } catch (err) {
    // Do not cache failures so a transient issue (missing tag on a
    // mid-release checkout, `.git/` not yet initialised, etc.) is
    // retried on the next call.
    cache.delete(projectRoot);
    throw err;
  }
}

async function runResolve(projectRoot: string, runGit: RunGit): Promise<string> {
  const args = [
    '-C',
    projectRoot,
    'describe',
    '--tags',
    '--abbrev=0',
    '--match',
    'v[0-9]*.[0-9]*.[0-9]*',
  ];
  const result = await runGit(args, { cwd: projectRoot });
  if (result.exitCode !== 0) {
    throw new CoreVersionUnavailableError(
      'git_describe_failed',
      result.stderr.trim() === '' ? undefined : result.stderr,
    );
  }
  const tag = result.stdout.trim();
  if (tag === '') {
    throw new CoreVersionUnavailableError('git_describe_empty');
  }
  return tag.startsWith('v') || tag.startsWith('V') ? tag.slice(1) : tag;
}
