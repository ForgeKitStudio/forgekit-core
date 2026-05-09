/**
 * Thin wrapper around `child_process.spawn` for invoking the `adb` binary.
 *
 * The binary path is resolved from `ADB_BIN` at call time, falling back to
 * the literal `"adb"`. Tests inject a fake `SpawnAdb` so they never touch
 * the real executable; production code uses `defaultSpawnAdb`.
 */

import { spawn } from 'node:child_process';

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Signature used by the Android tools and swapped in tests. */
export type SpawnAdb = (args: readonly string[]) => Promise<SpawnResult>;

export function adbBinary(): string {
  const fromEnv = process.env.ADB_BIN;
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv;
  }
  return 'adb';
}

export const defaultSpawnAdb: SpawnAdb = (args) => {
  return new Promise((resolve, reject) => {
    const child = spawn(adbBinary(), [...args], {
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
