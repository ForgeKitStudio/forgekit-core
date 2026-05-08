/**
 * Implementation of the `modules.list` MCP tool.
 *
 * Returns one entry per discovered module with the persisted
 * `enabled` flag and a `has_active_license` flag derived from the
 * presence of `<licenseDir>/<module_id>.key`. In production the MCP
 * server passes the OS-resolved form of Godot's `user://licenses/`
 * directory; tests pass a scratch directory.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { ToolInputError } from '../project/errors.js';
import { scanModules } from '../project/module_scan.js';
import { readModulesState } from './errors.js';

export interface ModulesListParams {
  /** Absolute path to the Godot project root. */
  projectRoot: string;
  /** Absolute path to the directory holding `<module_id>.key` files. */
  licenseDir: string;
}

export interface ListedModule {
  id: string;
  version: string;
  license_id: string;
  core_min_version: string;
  source_repo: string;
  enabled: boolean;
  has_active_license: boolean;
}

export interface ModulesListResult {
  modules: ListedModule[];
}

export async function modulesList(
  params: ModulesListParams,
): Promise<ModulesListResult> {
  if (
    typeof params.projectRoot !== 'string' ||
    params.projectRoot.trim() === ''
  ) {
    throw new ToolInputError(
      `"projectRoot" must be a non-empty string (got ${JSON.stringify(params.projectRoot)}).`,
    );
  }
  if (
    typeof params.licenseDir !== 'string' ||
    params.licenseDir.trim() === ''
  ) {
    throw new ToolInputError(
      `"licenseDir" must be a non-empty string (got ${JSON.stringify(params.licenseDir)}).`,
    );
  }

  const [discovered, state] = await Promise.all([
    scanModules(params.projectRoot),
    readModulesState(params.projectRoot),
  ]);

  const modules: ListedModule[] = [];
  for (const { manifest } of discovered) {
    const stateEntry = state[manifest.id];
    const enabled = stateEntry?.enabled ?? true;
    const hasLicense = await licenseFileExists(
      params.licenseDir,
      manifest.id,
    );
    modules.push({
      id: manifest.id,
      version: manifest.version,
      license_id: manifest.license_id,
      core_min_version: manifest.core_min_version,
      source_repo: manifest.source_repo,
      enabled,
      has_active_license: hasLicense,
    });
  }

  modules.sort((a, b) => a.id.localeCompare(b.id));
  return { modules };
}

async function licenseFileExists(
  licenseDir: string,
  moduleId: string,
): Promise<boolean> {
  try {
    await access(join(licenseDir, `${moduleId}.key`));
    return true;
  } catch {
    return false;
  }
}
