/**
 * Feature: forgekit, Property 49: ProjectRegistry operations are deterministic
 *
 * For every random sequence of N operations on a ProjectRegistry
 * (register / unregister / setActive / get / list), replaying the same
 * sequence on a fresh registry yields identical final state and
 * identical operation-by-operation observations. 100 iterations with
 * N ∈ [1..50].
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { FileSystemAdapter } from '../src/projects/registry.js';
import { ProjectRegistry } from '../src/projects/registry.js';
import type { WorkspacesPersistence } from '../src/projects/persistence.js';

const NUM_RUNS = 100 as const;

interface FakeFsState {
  roots: ReadonlySet<string>;
}

function memoryPersistence(): WorkspacesPersistence {
  let current = null;
  return {
    async read() {
      return current;
    },
    async write() {
      // ignore
    },
  };
}

function fakeFs(state: FakeFsState): FileSystemAdapter {
  return {
    isAbsolute: (p) => p.startsWith('/'),
    isDirectory: async (p) => state.roots.has(p),
    hasProjectGodot: async (p) => state.roots.has(p),
  };
}

type Op =
  | { kind: 'register'; workspace_id: string; projectRoot: string; label?: string }
  | { kind: 'unregister'; workspace_id: string }
  | { kind: 'setActive'; workspace_id: string }
  | { kind: 'get'; workspace_id: string }
  | { kind: 'list' };

/**
 * Each op returns a JSON-friendly observation (or the error code when
 * thrown) so two runs can be compared for equality.
 */
async function applyOp(
  registry: ProjectRegistry,
  op: Op,
): Promise<unknown> {
  try {
    switch (op.kind) {
      case 'register': {
        const args: Parameters<ProjectRegistry['register']>[0] = {
          workspace_id: op.workspace_id,
          projectRoot: op.projectRoot,
        };
        if (op.label !== undefined) args.label = op.label;
        const out = await registry.register(args);
        return { ok: true, op: op.kind, out };
      }
      case 'unregister': {
        const out = await registry.unregister(op.workspace_id);
        return { ok: true, op: op.kind, out };
      }
      case 'setActive': {
        const out = await registry.setActive(op.workspace_id);
        return { ok: true, op: op.kind, out };
      }
      case 'get':
        return { ok: true, op: op.kind, out: registry.get(op.workspace_id) };
      case 'list':
        return { ok: true, op: op.kind, out: registry.list() };
    }
  } catch (err) {
    const e = err as { code?: unknown; data?: unknown; message?: string };
    return {
      ok: false,
      op: op.kind,
      error: {
        code: e.code ?? null,
        data: e.data ?? null,
        message: e.message,
      },
    };
  }
}

const workspaceIdArb = fc
  .stringMatching(/^[a-z][a-z0-9_-]{0,6}$/)
  .filter((s) => /^[a-z][a-z0-9_-]{0,6}$/.test(s));

const projectRootArb = fc.constantFrom(
  '/p0',
  '/p1',
  '/p2',
  '/p3',
  '/p4',
  '/p5',
  '/unknown-root',
);

const labelArb = fc.option(fc.string({ minLength: 0, maxLength: 20 }), {
  nil: undefined,
});

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant('register' as const),
    workspace_id: workspaceIdArb,
    projectRoot: projectRootArb,
    label: labelArb,
  }),
  fc.record({
    kind: fc.constant('unregister' as const),
    workspace_id: workspaceIdArb,
  }),
  fc.record({
    kind: fc.constant('setActive' as const),
    workspace_id: workspaceIdArb,
  }),
  fc.record({
    kind: fc.constant('get' as const),
    workspace_id: workspaceIdArb,
  }),
  fc.record({
    kind: fc.constant('list' as const),
  }),
);

async function runSequence(seq: readonly Op[]): Promise<{
  observations: unknown[];
  snapshot: unknown;
}> {
  const state: FakeFsState = {
    roots: new Set(['/p0', '/p1', '/p2', '/p3', '/p4', '/p5']),
  };
  // Deterministic clock: tick once per op so registered_at is stable
  // between the two replays.
  let tick = 0;
  const clock = (): string => {
    const ms = 1000 * tick++;
    return new Date(ms).toISOString();
  };
  const registry = new ProjectRegistry(memoryPersistence(), fakeFs(state), clock);
  const observations: unknown[] = [];
  for (const op of seq) {
    observations.push(await applyOp(registry, op));
  }
  return { observations, snapshot: registry.serialize() };
}

describe('Property 49: ProjectRegistry operations are deterministic for identical operation sequences', () => {
  it('same sequence replayed on fresh registries yields identical state + observations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(opArb, { minLength: 1, maxLength: 50 }),
        async (seq) => {
          const first = await runSequence(seq);
          const second = await runSequence(seq);
          expect(second.observations).toEqual(first.observations);
          expect(second.snapshot).toEqual(first.snapshot);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
