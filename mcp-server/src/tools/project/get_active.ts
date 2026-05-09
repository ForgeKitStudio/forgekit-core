/**
 * Implementation of the `project.get_active` MCP tool.
 *
 * Returns the currently active workspace, or `{active_workspace_id: null,
 * workspace: null}` when the registry is empty. Read-only; no side effects.
 */

import type { ProjectRegistry } from '../../projects/registry.js';
import type { Workspace } from '../../projects/workspace.js';

export interface GetActiveWorkspaceDeps {
  registry: ProjectRegistry;
}

export interface GetActiveWorkspaceResult {
  active_workspace_id: string | null;
  workspace: Workspace | null;
}

export async function getActiveWorkspace(
  _params: Record<string, unknown>,
  deps: GetActiveWorkspaceDeps,
): Promise<GetActiveWorkspaceResult> {
  const workspace = deps.registry.getActive();
  return {
    active_workspace_id: workspace?.workspace_id ?? null,
    workspace,
  };
}
