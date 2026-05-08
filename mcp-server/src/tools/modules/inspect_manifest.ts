/**
 * Implementation of the `modules.inspect_manifest` MCP tool.
 *
 * Returns the full manifest object (including `depends_on`) plus the
 * absolute `manifest_path` that was read. Raises `ModuleNotFoundError`
 * when the requested id is not installed.
 */

import { ToolInputError } from '../project/errors.js';
import { scanModules } from '../project/module_scan.js';
import { ModuleNotFoundError } from './errors.js';

export interface InspectManifestParams {
  projectRoot: string;
  moduleId: string;
}

export interface InspectManifestResult {
  id: string;
  version: string;
  core_min_version: string;
  depends_on: string[];
  license_id: string;
  source_repo: string;
  manifest_path: string;
}

export async function inspectManifest(
  params: InspectManifestParams,
): Promise<InspectManifestResult> {
  if (
    typeof params.projectRoot !== 'string' ||
    params.projectRoot.trim() === ''
  ) {
    throw new ToolInputError(
      `"projectRoot" must be a non-empty string (got ${JSON.stringify(params.projectRoot)}).`,
    );
  }
  if (typeof params.moduleId !== 'string' || params.moduleId.trim() === '') {
    throw new ToolInputError(
      `"moduleId" must be a non-empty string (got ${JSON.stringify(params.moduleId)}).`,
    );
  }

  const discovered = await scanModules(params.projectRoot);
  const hit = discovered.find((m) => m.manifest.id === params.moduleId);
  if (!hit) {
    throw new ModuleNotFoundError(params.moduleId);
  }
  return {
    id: hit.manifest.id,
    version: hit.manifest.version,
    core_min_version: hit.manifest.core_min_version,
    depends_on: hit.manifest.depends_on,
    license_id: hit.manifest.license_id,
    source_repo: hit.manifest.source_repo,
    manifest_path: hit.manifestPath,
  };
}
