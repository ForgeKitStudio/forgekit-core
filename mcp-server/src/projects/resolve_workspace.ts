/**
 * Dispatcher middleware: resolve `workspace_id` + `projectRoot` for
 * every incoming JSON-RPC tool call.
 *
 * Four branches:
 *   1. `params.workspace_id` provided + known     → use that workspace.
 *   2. `params.workspace_id` provided + unknown   → WorkspaceNotFoundError.
 *   3. `params.workspace_id` absent + active set  → use active workspace.
 *   4. `params.workspace_id` absent + empty       → NoActiveWorkspaceError.
 *
 * After the branch decision we honour an explicit `params.projectRoot`
 * when it matches the resolved workspace and fail with
 * WorkspaceRootMismatchError when it diverges. Read-only tools that
 * predate Phase 7 can keep passing `projectRoot` directly and the
 * middleware will validate consistency automatically.
 *
 * The middleware is synchronous because the registry is in-memory; all
 * three error conditions are constructed eagerly so the dispatcher can
 * translate them into a JSON-RPC error envelope with no additional I/O.
 */

import {
  NoActiveWorkspaceError,
  WorkspaceNotFoundError,
  WorkspaceRootMismatchError,
} from './errors.js';
import type { ProjectRegistry } from './registry.js';
import type { Workspace } from './workspace.js';

/** Shape of the request params fragment the middleware cares about. */
export interface ResolveWorkspaceParams {
  workspace_id?: string;
  projectRoot?: string;
}

/** Output of a successful resolution. */
export interface ResolveWorkspaceResult {
  workspace: Workspace;
  projectRoot: string;
}

export function resolveWorkspace(
  registry: ProjectRegistry,
  params: ResolveWorkspaceParams | undefined,
): ResolveWorkspaceResult {
  const p = params ?? {};
  let workspace: Workspace | null;
  if (typeof p.workspace_id === 'string' && p.workspace_id !== '') {
    workspace = registry.get(p.workspace_id);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(p.workspace_id);
    }
  } else {
    workspace = registry.getActive();
    if (workspace === null) {
      throw new NoActiveWorkspaceError();
    }
  }

  const resolvedRoot = workspace.projectRoot;
  if (typeof p.projectRoot === 'string' && p.projectRoot !== resolvedRoot) {
    throw new WorkspaceRootMismatchError(
      workspace.workspace_id,
      resolvedRoot,
      p.projectRoot,
    );
  }
  return { workspace, projectRoot: resolvedRoot };
}
