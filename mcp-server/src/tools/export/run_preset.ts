/**
 * Implementation of the `export.run_preset` MCP tool.
 *
 * Spawns `godot --headless --export-release <preset> <output>` (or
 * `--export-debug` when `debug=true`) and captures stdout/stderr into a log
 * file under `user://export_logs/`. Returns `{success, log_path, artifact_path}`.
 */

import { mkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { ToolInputError } from '../testing/errors.js';
import {
  defaultSpawnGodot,
  type SpawnGodot,
} from '../testing/spawn_godot.js';

export interface RunPresetParams {
  preset_name: string;
  output_path: string;
  debug?: boolean;
}

export interface RunPresetResult {
  success: boolean;
  log_path: string;
  artifact_path: string;
}

export type WriteFile = (path: string, content: string) => Promise<void>;

export interface RunPresetDeps {
  spawn?: SpawnGodot;
  writeFile?: WriteFile;
  logDir?: string;
  now?: () => Date;
}

const defaultWriteFile: WriteFile = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await fsWriteFile(path, content, 'utf8');
};

function requireNonBlank(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

export async function runPreset(
  params: RunPresetParams,
  deps: RunPresetDeps = {},
): Promise<RunPresetResult> {
  const presetName = requireNonBlank(params.preset_name, 'preset_name');
  const outputPath = requireNonBlank(params.output_path, 'output_path');
  const debug = params.debug === true;

  const mode = debug ? '--export-debug' : '--export-release';
  const args: string[] = ['--headless', mode, presetName, outputPath];

  const spawn = deps.spawn ?? defaultSpawnGodot;
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const now = deps.now ?? (() => new Date());
  const logDir = deps.logDir ?? 'user://export_logs';

  const { stdout, stderr, exitCode } = await spawn(args);

  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const logPath = join(logDir, `export-${stamp}.log`);
  await writeFile(logPath, `stdout:\n${stdout}\n\nstderr:\n${stderr}\n`);

  return {
    success: exitCode === 0,
    log_path: logPath,
    artifact_path: outputPath,
  };
}
