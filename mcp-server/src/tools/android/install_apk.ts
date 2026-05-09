/**
 * Implementation of the `android.install_apk` MCP tool.
 *
 * Runs `adb install <apk>` (or `adb -s <serial> install <apk>` when a
 * device_serial is provided) and returns `{installed, output}`. The
 * `installed` flag is derived from adb's exit code — `installed=true` iff
 * exit code is 0.
 */

import { ToolInputError } from '../testing/errors.js';
import { defaultSpawnAdb, type SpawnAdb } from './spawn_adb.js';

export interface InstallApkParams {
  apk_path: string;
  device_serial?: string;
}

export interface InstallApkResult {
  installed: boolean;
  output: string;
}

export interface InstallApkDeps {
  spawn?: SpawnAdb;
}

function requireNonBlank(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

export async function installApk(
  params: InstallApkParams,
  deps: InstallApkDeps = {},
): Promise<InstallApkResult> {
  const apkPath = requireNonBlank(params.apk_path, 'apk_path');
  const spawn = deps.spawn ?? defaultSpawnAdb;

  const args: string[] = [];
  if (params.device_serial !== undefined && params.device_serial !== '') {
    args.push('-s', params.device_serial);
  }
  args.push('install', apkPath);

  const { stdout, stderr, exitCode } = await spawn(args);
  const output = [stdout, stderr].filter((s) => s !== '').join('\n');

  return { installed: exitCode === 0, output };
}
