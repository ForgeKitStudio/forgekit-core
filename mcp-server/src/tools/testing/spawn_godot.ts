/**
 * Thin wrapper around `child_process.spawn` for invoking the Godot binary.
 *
 * The binary path is not hard-coded: it resolves from `GODOT_BIN` at call
 * time, falling back to the literal `"godot"`. Tests inject a fake
 * `SpawnGodot` to avoid touching the real executable; production code uses
 * `defaultSpawnGodot`.
 */

import { spawn } from 'node:child_process';

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SpawnOptions {
  /** Extra environment variables merged on top of `process.env`. */
  env?: Record<string, string>;
  /** Working directory for the spawned process. */
  cwd?: string;
}

/** Signature used by the testing/QA tools and swapped in tests. */
export type SpawnGodot = (
  args: readonly string[],
  options?: SpawnOptions,
) => Promise<SpawnResult>;

/** Resolves the Godot binary path from the environment. */
export function godotBinary(): string {
  const fromEnv = process.env.GODOT_BIN;
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv;
  }
  return 'godot';
}

/**
 * Default implementation: spawns the resolved Godot binary with `args` and
 * collects stdout/stderr into strings. Exit code `null` (killed by signal)
 * is reported as `-1` so the caller can still distinguish it from success.
 */
export const defaultSpawnGodot: SpawnGodot = (args, options = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(godotBinary(), [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
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
