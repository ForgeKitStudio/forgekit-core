/**
 * Implementation of the `modules.disable` MCP tool.
 *
 * Flips the persisted `enabled` flag to `false` for the given module
 * id. The module must be discoverable by the scanner.
 */

import { setEnabled, type EnableModuleParams } from './enable.js';

export interface DisableModuleResult {
  module_id: string;
  enabled: false;
}

export async function disableModule(
  params: EnableModuleParams,
): Promise<DisableModuleResult> {
  const result = await setEnabled(params, false);
  return { module_id: result.module_id, enabled: false };
}
