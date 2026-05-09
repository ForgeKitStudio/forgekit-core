/**
 * Auto-registration of the default workspace at server startup.
 *
 * Pre-v0.9.0 clients launched `@forgekitstudio/core-mcp` inside a Godot
 * project's root directory. The server inferred everything from
 * `process.cwd()`. v0.9.0 introduces a formal registry, but we want
 * that upgrade path to be invisible: if the registry is empty and cwd
 * looks like a Godot project, register a workspace named `"default"`
 * so existing tool calls without `workspace_id` resolve the same way
 * as before.
 */

import { basename } from 'node:path';

import type { ProjectRegistry } from './registry.js';
import type { Workspace } from './workspace.js';

/** Inputs for `autoRegisterDefault`. */
export interface AutoRegisterOptions {
  /** The server process's current working directory. */
  cwd: string;
  /**
   * Optional override (e.g. the `--cwd` CLI flag). When set, takes
   * precedence over `cwd`.
   */
  envCwdOverride?: string;
}

/**
 * Register a `"default"` workspace when the registry is empty and the
 * resolved root is a valid Godot project. Returns the created
 * `Workspace` or `null` when no auto-registration happened.
 */
export async function autoRegisterDefault(
  registry: ProjectRegistry,
  options: AutoRegisterOptions,
): Promise<Workspace | null> {
  if (registry.size() > 0) {
    return null;
  }
  const candidate = options.envCwdOverride ?? options.cwd;
  if (!candidate.startsWith('/')) {
    return null;
  }

  try {
    const ws = await registry.register({
      workspace_id: 'default',
      projectRoot: candidate,
      label: basename(candidate),
    });
    return ws;
  } catch {
    // validation failure (missing project.godot, not-a-directory, etc.) — no-op.
    return null;
  }
}
