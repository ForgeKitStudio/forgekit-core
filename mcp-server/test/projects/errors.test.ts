/**
 * Tests for the project error hierarchy.
 *
 * Every error class carries a numeric JSON-RPC `code` in the reserved
 * multi-project range `-32015` to `-32022`, plus a structured `data`
 * record whose shape is enforced by Requirement 74.3.
 */

import { describe, expect, it } from 'vitest';

import {
  InvalidProjectRootError,
  NoActiveWorkspaceError,
  PortRangeExhaustedError,
  ProjectRootAlreadyRegisteredError,
  WorkspaceAlreadyRegisteredError,
  WorkspaceLimitExceededError,
  WorkspaceNotFoundError,
  WorkspaceRootMismatchError,
} from '../../src/projects/errors.js';

describe('WorkspaceNotFoundError', () => {
  it('uses code -32015 and carries data.workspace_id', () => {
    const err = new WorkspaceNotFoundError('client-a');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(-32015);
    expect(err.data).toEqual({ workspace_id: 'client-a' });
    expect(err.message).toContain('client-a');
  });
});

describe('WorkspaceAlreadyRegisteredError', () => {
  it('uses code -32016 and carries data.workspace_id + data.existing_workspace', () => {
    const existing = {
      workspace_id: 'client-a',
      projectRoot: '/a',
      registered_at: '2026-05-09T19:30:00.000Z',
      active: true,
    };
    const err = new WorkspaceAlreadyRegisteredError('client-a', existing);
    expect(err.code).toBe(-32016);
    expect(err.data).toEqual({
      workspace_id: 'client-a',
      existing_workspace: existing,
    });
  });
});

describe('ProjectRootAlreadyRegisteredError', () => {
  it('uses code -32017 and carries data.projectRoot + data.existing_workspace_id', () => {
    const err = new ProjectRootAlreadyRegisteredError('/a', 'other');
    expect(err.code).toBe(-32017);
    expect(err.data).toEqual({
      projectRoot: '/a',
      existing_workspace_id: 'other',
    });
  });
});

describe('InvalidProjectRootError', () => {
  it('uses code -32018 and carries data.projectRoot + data.reason', () => {
    for (const reason of ['not_absolute', 'not_a_directory', 'missing_project_godot'] as const) {
      const err = new InvalidProjectRootError('/bad', reason);
      expect(err.code).toBe(-32018);
      expect(err.data).toEqual({ projectRoot: '/bad', reason });
    }
  });
});

describe('WorkspaceLimitExceededError', () => {
  it('uses code -32019 and carries data.limit + data.current', () => {
    const err = new WorkspaceLimitExceededError(32, 32);
    expect(err.code).toBe(-32019);
    expect(err.data).toEqual({ limit: 32, current: 32 });
  });
});

describe('PortRangeExhaustedError', () => {
  it('uses code -32020 and carries channel/range/in_use', () => {
    const err = new PortRangeExhaustedError({
      channel: 'editor',
      range_start: 6010,
      range_end: 6019,
      in_use: [6010, 6011, 6012],
    });
    expect(err.code).toBe(-32020);
    expect(err.data).toEqual({
      channel: 'editor',
      range_start: 6010,
      range_end: 6019,
      in_use: [6010, 6011, 6012],
    });
  });
});

describe('NoActiveWorkspaceError', () => {
  it('uses code -32021 with empty data', () => {
    const err = new NoActiveWorkspaceError();
    expect(err.code).toBe(-32021);
    expect(err.data).toEqual({});
  });
});

describe('WorkspaceRootMismatchError', () => {
  it('uses code -32022 and carries workspace_id + registered_project_root + requested_project_root', () => {
    const err = new WorkspaceRootMismatchError(
      'client-a',
      '/registered',
      '/requested',
    );
    expect(err.code).toBe(-32022);
    expect(err.data).toEqual({
      workspace_id: 'client-a',
      registered_project_root: '/registered',
      requested_project_root: '/requested',
    });
  });
});
