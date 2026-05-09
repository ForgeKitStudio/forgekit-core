/**
 * Implementation of the `export.validate_preset` MCP tool.
 *
 * Reads `export_presets.cfg`, locates the named preset, and verifies that
 * `name`, `platform`, and `export_path` are present and non-empty. Missing
 * fields are returned as `{field, reason}` entries in the `errors` array.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseExportPresets } from './presets_parser.js';

export interface ValidatePresetParams {
  preset_name: string;
  project_root?: string;
}

export interface ValidationError {
  field: string;
  reason: string;
}

export interface ValidatePresetResult {
  valid: boolean;
  errors: ValidationError[];
}

export type ReadFile = (path: string) => Promise<string>;

export interface ValidatePresetDeps {
  readFile?: ReadFile;
  cwd?: () => string;
}

const defaultReadFile: ReadFile = (path) => fsReadFile(path, 'utf8');

export async function validatePreset(
  params: ValidatePresetParams,
  deps: ValidatePresetDeps = {},
): Promise<ValidatePresetResult> {
  const readFile = deps.readFile ?? defaultReadFile;
  const cwd = deps.cwd ?? (() => process.cwd());
  const root = params.project_root ?? cwd();
  const path = join(root, 'export_presets.cfg');

  const cfg = await readFile(path);
  const presets = parseExportPresets(cfg);
  const preset = presets.find((p) => p.name === params.preset_name);

  if (preset === undefined) {
    return {
      valid: false,
      errors: [
        {
          field: 'preset_name',
          reason: `preset "${params.preset_name}" not found in export_presets.cfg`,
        },
      ],
    };
  }

  const errors: ValidationError[] = [];
  if (preset.name.trim() === '') {
    errors.push({ field: 'name', reason: 'name is empty' });
  }
  if (preset.platform.trim() === '') {
    errors.push({ field: 'platform', reason: 'platform is empty' });
  }
  if (preset.export_path.trim() === '') {
    errors.push({ field: 'export_path', reason: 'export_path is empty' });
  }

  return { valid: errors.length === 0, errors };
}
