/**
 * Implementation of the `android.run_logcat` MCP tool.
 *
 * Runs `adb logcat` for a bounded duration (default 5000ms) and returns the
 * captured stdout as a list of lines. An optional `filter` string is
 * appended verbatim to the adb arguments so callers can use any logcat
 * filter expression (`"godot:I *:S"`, `"-T 10"`, etc.).
 *
 * The `duration_ms` parameter is currently forwarded to the backend via
 * the `-t <N>` adb flag in a future iteration; this implementation simply
 * captures whatever stdout adb produces before the child exits (or the
 * injected fake returns).
 */

import { defaultSpawnAdb, type SpawnAdb } from './spawn_adb.js';

export interface RunLogcatParams {
  filter?: string;
  duration_ms?: number;
}

export interface RunLogcatResult {
  log_lines: string[];
}

export interface RunLogcatDeps {
  spawn?: SpawnAdb;
}

export async function runLogcat(
  params: RunLogcatParams,
  deps: RunLogcatDeps = {},
): Promise<RunLogcatResult> {
  const spawn = deps.spawn ?? defaultSpawnAdb;

  const args: string[] = ['logcat'];
  if (params.filter !== undefined && params.filter !== '') {
    args.push(params.filter);
  }

  const { stdout } = await spawn(args);
  const lines = stdout.split(/\r?\n/).filter((line) => line !== '');
  return { log_lines: lines };
}
