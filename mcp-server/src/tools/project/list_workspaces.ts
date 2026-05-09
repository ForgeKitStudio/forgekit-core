/**
 * Implementation of the `project.list_workspaces` MCP tool.
 *
 * Read-only view over the ProjectRegistry. The handler is a thin shim
 * that materializes the list + the id of the currently active
 * workspace + the hard `MAX_WORKSPACES` limit so clients can build
 * quotas UI without re-importing the constant.
 */

import { MAX_WORKSPACES, type Workspace } from '../../projects/workspace.js';
import type { ProjectRegistry } from '../../projects/registry.js';

export interface ListWorkspacesDeps {
  registry: ProjectRegistry;
}

export interface ListWorkspacesResult {
  workspaces: Workspace[];
  active_workspace_id: string | null;
  limit: number;
}

export async function listWorkspaces(
  _params: Record<string, unknown>,
  deps: ListWorkspacesDeps,
): Promise<ListWorkspacesResult> {
  const workspaces = deps.registry.list();
  const active = deps.registry.getActive();
  return {
    workspaces,
    active_workspace_id: active?.workspace_id ?? null,
    limit: MAX_WORKSPACES,
  };
}
