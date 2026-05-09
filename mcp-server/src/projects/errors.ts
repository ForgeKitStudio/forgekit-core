/**
 * Error hierarchy for the multi-project subsystem.
 *
 * Every class carries a numeric JSON-RPC `code` in the reserved
 * multi-project range (-32015 to -32022) plus a structured `data`
 * record so the dispatcher can forward the envelope to clients without
 * any reshaping. The payload shapes below are the contract Property 51
 * verifies.
 */

import type { Workspace } from './workspace.js';

/** Channel names used by the per-workspace port pool. */
export type ChannelName = 'editor' | 'runtime' | 'visualizer' | 'health';

/** Reason enum for `InvalidProjectRootError.data.reason`. */
export type InvalidProjectRootReason =
  | 'not_absolute'
  | 'not_a_directory'
  | 'missing_project_godot';

/** Base class so callers can catch every `-3201x` error at once. */
export abstract class ProjectError extends Error {
  abstract readonly code: number;
  abstract readonly data: Record<string, unknown>;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class WorkspaceNotFoundError extends ProjectError {
  readonly code = -32015;
  readonly data: { workspace_id: string };

  constructor(workspace_id: string) {
    super(`Workspace "${workspace_id}" is not registered.`);
    this.data = { workspace_id };
  }
}

export class WorkspaceAlreadyRegisteredError extends ProjectError {
  readonly code = -32016;
  readonly data: { workspace_id: string; existing_workspace: Workspace };

  constructor(workspace_id: string, existing_workspace: Workspace) {
    super(`Workspace "${workspace_id}" is already registered.`);
    this.data = { workspace_id, existing_workspace };
  }
}

export class ProjectRootAlreadyRegisteredError extends ProjectError {
  readonly code = -32017;
  readonly data: { projectRoot: string; existing_workspace_id: string };

  constructor(projectRoot: string, existing_workspace_id: string) {
    super(
      `projectRoot "${projectRoot}" is already registered under workspace "${existing_workspace_id}".`,
    );
    this.data = { projectRoot, existing_workspace_id };
  }
}

export class InvalidProjectRootError extends ProjectError {
  readonly code = -32018;
  readonly data: { projectRoot: string; reason: InvalidProjectRootReason };

  constructor(projectRoot: string, reason: InvalidProjectRootReason) {
    super(`projectRoot "${projectRoot}" is invalid: ${reason}.`);
    this.data = { projectRoot, reason };
  }
}

export class WorkspaceLimitExceededError extends ProjectError {
  readonly code = -32019;
  readonly data: { limit: number; current: number };

  constructor(limit: number, current: number) {
    super(
      `Workspace limit exceeded (limit ${limit}, current ${current}). ` +
        'Unregister an existing workspace before registering a new one.',
    );
    this.data = { limit, current };
  }
}

export interface PortRangeExhaustedDetails {
  channel: ChannelName;
  range_start: number;
  range_end: number;
  in_use: number[];
  [key: string]: unknown;
}

export class PortRangeExhaustedError extends ProjectError {
  readonly code = -32020;
  readonly data: PortRangeExhaustedDetails;

  constructor(details: PortRangeExhaustedDetails) {
    super(
      `Port range [${details.range_start}, ${details.range_end}] for channel "${details.channel}" is exhausted.`,
    );
    this.data = {
      channel: details.channel,
      range_start: details.range_start,
      range_end: details.range_end,
      in_use: [...details.in_use],
    };
  }
}

export class NoActiveWorkspaceError extends ProjectError {
  readonly code = -32021;
  readonly data: Record<string, unknown> = {};

  constructor() {
    super(
      'No active workspace. Register one with project.add or use ' +
        '--cwd on startup so the server can auto-register a default.',
    );
  }
}

export class WorkspaceRootMismatchError extends ProjectError {
  readonly code = -32022;
  readonly data: {
    workspace_id: string;
    registered_project_root: string;
    requested_project_root: string;
  };

  constructor(
    workspace_id: string,
    registered_project_root: string,
    requested_project_root: string,
  ) {
    super(
      `Explicit projectRoot "${requested_project_root}" does not match ` +
        `workspace "${workspace_id}" registered root "${registered_project_root}".`,
    );
    this.data = {
      workspace_id,
      registered_project_root,
      requested_project_root,
    };
  }
}
