/**
 * Feature: forgekit, Property 51: ProjectRegistry errors carry the documented data shape
 *
 * Every error thrown by the multi-project subsystem sits in the
 * reserved JSON-RPC range -32015..-32022 and carries the data fields
 * documented in Requirement 74.3. 100 iterations exercise each error
 * class with randomly generated inputs and verify that:
 *   - `err.code` ∈ [-32022, -32015]
 *   - `err.data` has exactly the documented keys for that error class
 *   - nested values round-trip unchanged through JSON.stringify
 */

import fc from 'fast-check';
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
  type ChannelName,
  type InvalidProjectRootReason,
} from '../src/projects/errors.js';
import type { Workspace } from '../src/projects/workspace.js';

const NUM_RUNS = 100 as const;

const MIN_CODE = -32022;
const MAX_CODE = -32015;

const workspaceIdArb = fc.stringMatching(/^[a-z][a-z0-9_-]{0,20}$/);
const projectRootArb = fc.stringMatching(/^\/[a-z0-9_/-]{1,40}$/);

const workspaceArb: fc.Arbitrary<Workspace> = fc.record({
  workspace_id: workspaceIdArb,
  projectRoot: projectRootArb,
  registered_at: fc.constant('2026-05-09T19:30:00.000Z'),
  active: fc.boolean(),
});

const reasonArb: fc.Arbitrary<InvalidProjectRootReason> = fc.constantFrom(
  'not_absolute',
  'not_a_directory',
  'missing_project_godot',
);

const channelArb: fc.Arbitrary<ChannelName> = fc.constantFrom(
  'editor',
  'runtime',
  'visualizer',
  'health',
);

function assertCodeInRange(code: unknown): void {
  expect(typeof code).toBe('number');
  expect(code as number).toBeGreaterThanOrEqual(MIN_CODE);
  expect(code as number).toBeLessThanOrEqual(MAX_CODE);
}

function assertRoundTrips(err: { code: number; data: Record<string, unknown> }): void {
  // The envelope the dispatcher sends is {code, message, data}; make
  // sure data round-trips through JSON.stringify without losing fields.
  const payload = { code: err.code, data: err.data };
  const cloned = JSON.parse(JSON.stringify(payload));
  expect(cloned).toEqual(payload);
}

describe('Property 51: ProjectRegistry errors carry the documented data shape', () => {
  it('WorkspaceNotFoundError (-32015) carries data.workspace_id', () => {
    fc.assert(
      fc.property(workspaceIdArb, (id) => {
        const err = new WorkspaceNotFoundError(id);
        expect(err.code).toBe(-32015);
        assertCodeInRange(err.code);
        expect(err.data).toEqual({ workspace_id: id });
        assertRoundTrips(err);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('WorkspaceAlreadyRegisteredError (-32016) carries data.workspace_id + data.existing_workspace', () => {
    fc.assert(
      fc.property(workspaceIdArb, workspaceArb, (id, ws) => {
        const err = new WorkspaceAlreadyRegisteredError(id, ws);
        expect(err.code).toBe(-32016);
        assertCodeInRange(err.code);
        expect(err.data).toEqual({
          workspace_id: id,
          existing_workspace: ws,
        });
        assertRoundTrips(err);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('ProjectRootAlreadyRegisteredError (-32017) carries data.projectRoot + data.existing_workspace_id', () => {
    fc.assert(
      fc.property(projectRootArb, workspaceIdArb, (root, existingId) => {
        const err = new ProjectRootAlreadyRegisteredError(root, existingId);
        expect(err.code).toBe(-32017);
        assertCodeInRange(err.code);
        expect(err.data).toEqual({
          projectRoot: root,
          existing_workspace_id: existingId,
        });
        assertRoundTrips(err);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('InvalidProjectRootError (-32018) carries data.projectRoot + data.reason', () => {
    fc.assert(
      fc.property(projectRootArb, reasonArb, (root, reason) => {
        const err = new InvalidProjectRootError(root, reason);
        expect(err.code).toBe(-32018);
        assertCodeInRange(err.code);
        expect(err.data).toEqual({ projectRoot: root, reason });
        assertRoundTrips(err);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('WorkspaceLimitExceededError (-32019) carries data.limit + data.current', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 64 }),
        (limit, current) => {
          const err = new WorkspaceLimitExceededError(limit, current);
          expect(err.code).toBe(-32019);
          assertCodeInRange(err.code);
          expect(err.data).toEqual({ limit, current });
          assertRoundTrips(err);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('PortRangeExhaustedError (-32020) carries data.channel + data.range_start + data.range_end + data.in_use', () => {
    fc.assert(
      fc.property(
        channelArb,
        fc.integer({ min: 1024, max: 60000 }),
        fc.integer({ min: 0, max: 50 }),
        fc.array(fc.integer({ min: 1024, max: 60000 }), { maxLength: 32 }),
        (channel, start, width, ports) => {
          const end = start + width;
          const err = new PortRangeExhaustedError({
            channel,
            range_start: start,
            range_end: end,
            in_use: ports,
          });
          expect(err.code).toBe(-32020);
          assertCodeInRange(err.code);
          expect(err.data.channel).toBe(channel);
          expect(err.data.range_start).toBe(start);
          expect(err.data.range_end).toBe(end);
          expect(err.data.in_use).toEqual(ports);
          assertRoundTrips(err);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('NoActiveWorkspaceError (-32021) carries an empty data object', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const err = new NoActiveWorkspaceError();
        expect(err.code).toBe(-32021);
        assertCodeInRange(err.code);
        expect(err.data).toEqual({});
        assertRoundTrips(err);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('WorkspaceRootMismatchError (-32022) carries workspace_id + registered + requested project roots', () => {
    fc.assert(
      fc.property(workspaceIdArb, projectRootArb, projectRootArb, (id, a, b) => {
        const err = new WorkspaceRootMismatchError(id, a, b);
        expect(err.code).toBe(-32022);
        assertCodeInRange(err.code);
        expect(err.data).toEqual({
          workspace_id: id,
          registered_project_root: a,
          requested_project_root: b,
        });
        assertRoundTrips(err);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
