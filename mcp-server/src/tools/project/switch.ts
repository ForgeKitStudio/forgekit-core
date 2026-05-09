/**
 * Implementation of the `project.switch` MCP tool.
 *
 * Atomically changes the active workspace. Idempotent on self-switch.
 * Throws WorkspaceNotFoundError (-32015) for unknown ids; the
 * dispatcher translates that into the JSON-RPC error envelope.
 */

import { ToolInputError } from './errors.js';
import type { ProjectRegistry } from '../../projects/registry.js';

export interface SwitchWorkspaceParams {
  workspace_id: string;
}

export interface SwitchWorkspaceDeps {
  registry: ProjectRegistry;
}

export interface SwitchWorkspaceResult {
  previous_workspace_id: string | null;
  active_workspace_id: string;
}

export async function switchWorkspace(
  params: SwitchWorkspaceParams,
  deps: SwitchWorkspaceDeps,
): Promise<SwitchWorkspaceResult> {
  if (typeof params?.workspace_id !== 'string' || params.workspace_id === '') {
    throw new ToolInputError(
      '"workspace_id" must be a non-empty string.',
    );
  }
  const previous = deps.registry.getActive();
  const target = await deps.registry.setActive(params.workspace_id);
  return {
    previous_workspace_id: previous?.workspace_id ?? null,
    active_workspace_id: target.workspace_id,
  };
}
