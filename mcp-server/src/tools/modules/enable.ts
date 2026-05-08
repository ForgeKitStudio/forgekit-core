/**
 * Implementation of the `modules.enable` MCP tool.
 *
 * Flips the persisted `enabled` flag to `true` for the given module
 * id. The module must be discoverable by the scanner.
 */

import { ToolInputError } from '../project/errors.js';
import { scanModules } from '../project/module_scan.js';
import {
  ModuleNotFoundError,
  readModulesState,
  writeModulesState,
} from './errors.js';

export interface EnableModuleParams {
  projectRoot: string;
  moduleId: string;
}

export interface EnableModuleResult {
  module_id: string;
  enabled: true;
}

export async function enableModule(
  params: EnableModuleParams,
): Promise<EnableModuleResult> {
  await setEnabled(params, true);
  return { module_id: params.moduleId, enabled: true };
}

export async function setEnabled(
  params: EnableModuleParams,
  enabled: boolean,
): Promise<{ module_id: string; enabled: boolean }> {
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

  const state = await readModulesState(params.projectRoot);
  state[params.moduleId] = { enabled };
  await writeModulesState(params.projectRoot, state);
  return { module_id: params.moduleId, enabled };
}
