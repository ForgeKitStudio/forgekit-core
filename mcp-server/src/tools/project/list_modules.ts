/**
 * Implementation of the `project.list_modules` MCP tool.
 *
 * Returns `{modules: [{id, version, license_id, core_min_version,
 * source_repo, enabled}]}` for every `forgekit_*` module directory that
 * ships a `module.manifest.tres` file. `enabled` defaults to `true` — a
 * future `modules.enable` / `modules.disable` pair will flip it; for
 * now, any discoverable module is considered enabled.
 */

import { ToolInputError } from './errors.js';
import { scanModules } from './module_scan.js';

export interface ListModulesParams {
  /** Absolute path to the Godot project root. */
  projectRoot: string;
}

export interface ListedModule {
  id: string;
  version: string;
  license_id: string;
  core_min_version: string;
  source_repo: string;
  enabled: boolean;
}

export interface ListModulesResult {
  modules: ListedModule[];
}

export async function listModules(
  params: ListModulesParams,
): Promise<ListModulesResult> {
  if (typeof params.projectRoot !== 'string' || params.projectRoot.trim() === '') {
    throw new ToolInputError(
      `"projectRoot" must be a non-empty string (got ${JSON.stringify(params.projectRoot)}).`,
    );
  }

  const discovered = await scanModules(params.projectRoot);
  const modules: ListedModule[] = discovered
    .map(({ manifest }) => ({
      id: manifest.id,
      version: manifest.version,
      license_id: manifest.license_id,
      core_min_version: manifest.core_min_version,
      source_repo: manifest.source_repo,
      enabled: true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { modules };
}
