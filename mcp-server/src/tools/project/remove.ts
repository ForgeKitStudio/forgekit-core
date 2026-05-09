/**
 * Implementation of the `project.remove` MCP tool.
 *
 * Unregisters a workspace. When the removed workspace was active the
 * registry auto-promotes the most recently registered remaining
 * workspace; if no workspaces remain, active_workspace_id is null.
 * Unknown ids are a no-op returning {removed: null} per the
 * Requirement 72.3 idempotency contract.
 */

import { ToolInputError } from './errors.js';
import type { ProjectRegistry } from '../../projects/registry.js';
import type { Workspace } from '../../projects/workspace.js';

export interface RemoveWorkspaceParams {
  workspace_id: string;
}

export interface RemoveWorkspaceDeps {
  registry: ProjectRegistry;
}

export interface RemoveWorkspaceResult {
  removed: Workspace | null;
  active_workspace_id: string | null;
}

export async function removeWorkspace(
  params: RemoveWorkspaceParams,
  deps: RemoveWorkspaceDeps,
): Promise<RemoveWorkspaceResult> {
  if (typeof params?.workspace_id !== 'string' || params.workspace_id === '') {
    throw new ToolInputError('"workspace_id" must be a non-empty string.');
  }
  const { removed } = await deps.registry.unregister(params.workspace_id);
  const active = deps.registry.getActive();
  return {
    removed,
    active_workspace_id: active?.workspace_id ?? null,
  };
}
