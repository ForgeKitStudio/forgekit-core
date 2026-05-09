/**
 * Implementation of the `project.add` MCP tool.
 *
 * Registers a new workspace and, optionally, switches the active
 * pointer to it. Idempotent when the caller re-adds the same id /
 * projectRoot / label triple; the registry itself raises
 * WorkspaceAlreadyRegisteredError (-32016) when fields diverge.
 */

import { ToolInputError } from './errors.js';
import type { ProjectRegistry } from '../../projects/registry.js';
import type { Workspace } from '../../projects/workspace.js';

export interface AddWorkspaceParams {
  workspace_id: string;
  projectRoot: string;
  label?: string;
  make_active?: boolean;
}

export interface AddWorkspaceDeps {
  registry: ProjectRegistry;
}

export interface AddWorkspaceResult {
  workspace: Workspace;
}

export async function addWorkspace(
  params: AddWorkspaceParams,
  deps: AddWorkspaceDeps,
): Promise<AddWorkspaceResult> {
  if (typeof params?.workspace_id !== 'string' || params.workspace_id === '') {
    throw new ToolInputError('"workspace_id" must be a non-empty string.');
  }
  if (typeof params?.projectRoot !== 'string' || params.projectRoot === '') {
    throw new ToolInputError('"projectRoot" must be a non-empty string.');
  }
  const registerArgs: Parameters<ProjectRegistry['register']>[0] = {
    workspace_id: params.workspace_id,
    projectRoot: params.projectRoot,
  };
  if (params.label !== undefined) {
    registerArgs.label = params.label;
  }
  const workspace = await deps.registry.register(registerArgs);
  if (params.make_active === true) {
    const active = await deps.registry.setActive(workspace.workspace_id);
    return { workspace: active };
  }
  return { workspace };
}
