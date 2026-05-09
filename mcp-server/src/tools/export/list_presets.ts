/**
 * Implementation of the `export.list_presets` MCP tool.
 *
 * Reads `export_presets.cfg` from the project root (or an explicit
 * `project_root` parameter) and returns the list of defined presets with
 * `name`, `platform`, `runnable`, and `export_path` fields.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ExportPresetsFileMissingError } from './errors.js';
import { parseExportPresets, type ExportPreset } from './presets_parser.js';

export interface ListPresetsParams {
  /** Optional project root override; defaults to `process.cwd()`. */
  project_root?: string;
}

export interface ListPresetsResult {
  presets: ExportPreset[];
}

export type ReadFile = (path: string) => Promise<string>;

export interface ListPresetsDeps {
  readFile?: ReadFile;
  cwd?: () => string;
}

const defaultReadFile: ReadFile = (path) => fsReadFile(path, 'utf8');

export async function listPresets(
  params: ListPresetsParams,
  deps: ListPresetsDeps = {},
): Promise<ListPresetsResult> {
  const readFile = deps.readFile ?? defaultReadFile;
  const cwd = deps.cwd ?? (() => process.cwd());
  const root = params.project_root ?? cwd();
  const path = join(root, 'export_presets.cfg');

  let cfg: string;
  try {
    cfg = await readFile(path);
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      throw new ExportPresetsFileMissingError(path);
    }
    throw err;
  }

  return { presets: parseExportPresets(cfg) };
}

function isNodeErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err;
}
