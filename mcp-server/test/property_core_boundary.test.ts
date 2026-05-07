/**
 * Feature: forgekit, Property 9: CORE_BOUNDARY_VIOLATION for every tool modifying a file in ForgeKit_Core
 *
 * Property-based test for the MCP server's Core Boundary guard. The
 * guard mirrors the GDScript `CoreBoundary` module shipped in
 * `addons/forgekit_core/boundary/core_boundary.gd`: a set of
 * `READ_ONLY_PATHS` and glob `DENY_WRITE_PATTERNS` that together mark
 * `addons/forgekit_core/**` and `addons/gut/**` as off-limits for any
 * agent-driven write.
 *
 * For every iteration the generator produces:
 *   1. A random project-relative path inside the boundary (rooted at
 *      either `addons/forgekit_core/` or, less often, `addons/gut/`).
 *      The primary coverage is `addons/forgekit_core/**` — the path
 *      carries a random directory depth (0..3) and a random file
 *      extension drawn from `.gd | .tres | .tscn | .cfg`.
 *   2. A random mutating-tool driver selected from the set of MCP
 *      tools that can write a file under the project root. Current
 *      coverage: `atomic_write` (raw `atomicWriteFile`) and
 *      `update_settings` (merges into `project.godot`). Both drivers
 *      bottom out on the same boundary guard.
 *
 * Properties (each run {@link NUM_RUNS} times):
 *   P1 — every `(path, tool)` pair is rejected with JSON-RPC error
 *        `code === -32002`, `message === 'CORE_BOUNDARY_VIOLATION'`,
 *        `data.path` equal to the path the tool would have written,
 *        and `data.matched_rule` equal to one of the boundary rules.
 *   P2 — negative control: a random path rooted outside the boundary
 *        (e.g. `addons/forgekit_rpg/...`, `scenes/...`, `scripts/...`)
 *        is NOT rejected by `violationFor` — the guard returns null.
 */

import fc from 'fast-check';
import { posix as posixPath } from 'node:path';
import { describe, expect, it } from 'vitest';

import { atomicWriteFile } from '../src/tools/project/atomic_writer.js';
import {
  DENY_WRITE_PATTERNS,
  READ_ONLY_PATHS,
  violationFor,
} from '../src/tools/project/core_boundary.js';
import { updateSettings } from '../src/tools/project/update_settings.js';

// --------------------------------------------------------------------------
// Shared constants
// --------------------------------------------------------------------------

/** Pinned iteration count applied to every property in this file. */
const NUM_RUNS = 100 as const;

/** All boundary rules the guard may cite as `data.matched_rule`. */
const ALL_RULES: readonly string[] = [
  ...READ_ONLY_PATHS,
  ...DENY_WRITE_PATTERNS,
];

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

const segmentArb = fc
  .stringMatching(/^[a-z_][a-z0-9_]{0,10}$/)
  .filter((s) => s.length > 0);

const extensionArb = fc.constantFrom('.gd', '.tres', '.tscn', '.cfg');

const filenameArb = fc
  .tuple(segmentArb, extensionArb)
  .map(([name, ext]) => `${name}${ext}`);

/**
 * Random project-relative path rooted inside the boundary. Weighted
 * toward `addons/forgekit_core/` (primary coverage per the task) while
 * still exercising `addons/gut/` occasionally.
 */
const boundaryRootArb = fc.oneof(
  { arbitrary: fc.constant('addons/forgekit_core'), weight: 4 },
  { arbitrary: fc.constant('addons/gut'), weight: 1 },
);

const pathInsideBoundaryArb = fc
  .tuple(
    boundaryRootArb,
    fc.array(segmentArb, { minLength: 0, maxLength: 3 }),
    filenameArb,
  )
  .map(([root, dirs, file]) => [root, ...dirs, file].join('/'));

/** Paths rooted outside both boundary roots. */
const outsideRootArb = fc.constantFrom(
  'addons/forgekit_rpg',
  'addons/forgekit_survivors',
  'scenes',
  'scripts',
  'assets',
);

const pathOutsideBoundaryArb = fc
  .tuple(
    outsideRootArb,
    fc.array(segmentArb, { minLength: 0, maxLength: 3 }),
    filenameArb,
  )
  .map(([root, dirs, file]) => [root, ...dirs, file].join('/'));

// --------------------------------------------------------------------------
// Tool drivers — one per mutating MCP tool wired up with the boundary guard
// --------------------------------------------------------------------------

interface ToolDriver {
  readonly name: string;
  /**
   * The path the guard should cite when rejecting a call made with
   * `p` as the tool's primary path argument.
   */
  readonly expectedPath: (p: string) => string;
  /** Invoke the tool; expected to throw a boundary violation payload. */
  readonly invoke: (p: string) => Promise<unknown>;
}

const atomicWriteDriver: ToolDriver = {
  name: 'atomic_write',
  expectedPath: (p) => p,
  invoke: (p) => atomicWriteFile(p, ''),
};

const updateSettingsDriver: ToolDriver = {
  name: 'update_settings',
  expectedPath: (p) => posixPath.join(p, 'project.godot'),
  invoke: (p) =>
    updateSettings({
      projectRoot: p,
      patch: { 'application/config/name': '"x"' },
    }),
};

const DRIVERS: readonly ToolDriver[] = [atomicWriteDriver, updateSettingsDriver];

const driverArb = fc.constantFrom(...DRIVERS);

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

interface ViolationShape {
  readonly code: number;
  readonly message: string;
  readonly data: {
    readonly path: string;
    readonly matched_rule: string;
  };
}

async function captureRejection(
  invoke: () => Promise<unknown>,
): Promise<unknown> {
  try {
    await invoke();
  } catch (err) {
    return err;
  }
  throw new Error('expected invocation to reject but it resolved');
}

function assertBoundaryViolation(
  err: unknown,
  expectedPath: string,
): asserts err is ViolationShape {
  expect(err).toBeDefined();
  const payload = err as ViolationShape;
  expect(payload.code).toBe(-32002);
  expect(payload.message).toBe('CORE_BOUNDARY_VIOLATION');
  expect(payload.data).toBeDefined();
  expect(payload.data.path).toBe(expectedPath);
  expect(typeof payload.data.matched_rule).toBe('string');
  expect(payload.data.matched_rule.length).toBeGreaterThan(0);
  expect(ALL_RULES.includes(payload.data.matched_rule)).toBe(true);
}

// --------------------------------------------------------------------------
// Properties
// --------------------------------------------------------------------------

describe('Property 9: CORE_BOUNDARY_VIOLATION for every tool modifying a file in ForgeKit_Core', () => {
  it('P1: every mutating tool rejects boundary paths with -32002 and data.path == expectedPath', async () => {
    await fc.assert(
      fc.asyncProperty(
        pathInsideBoundaryArb,
        driverArb,
        async (p, driver) => {
          const err = await captureRejection(() => driver.invoke(p));
          assertBoundaryViolation(err, driver.expectedPath(p));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('P2: negative control — paths outside the boundary are not rejected by violationFor', () => {
    fc.assert(
      fc.property(pathOutsideBoundaryArb, (p) => {
        expect(violationFor(p)).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
