/**
 * Feature: forgekit, Property 50: Concurrent workspaces never share the same port on the same channel
 *
 * For any K ∈ [1..8] sequential scanFreePort(range, {excluded, channel})
 * calls where each call's excluded set is the union of every previous
 * call's return value plus a random initial in-use set, the K returned
 * ports are pair-wise distinct and none equals an initially-excluded
 * port. 100 iterations over random range widths and initial excluded sets.
 */

import { createServer, type Server } from 'node:net';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PortRangeExhaustedError } from '../src/projects/errors.js';
import { scanFreePort } from '../src/port_scanner.js';

const NUM_RUNS = 100 as const;

/** Port range deliberately in a high unused block so CI doesn't collide. */
const BASE_RANGE_START = 56000 as const;

describe('Property 50: Concurrent workspaces never share the same port on the same channel', () => {
  it('K sequential scanFreePort calls produce K distinct ports, honouring excluded', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 10 }),
        async (K, initialInUseCount, offset) => {
          // Build a range at least K + initialInUseCount + 2 wide so we
          // always have enough ports to satisfy K requests.
          const start = BASE_RANGE_START + offset;
          const end = start + K + initialInUseCount + 2;
          const range = { start, end } as const;
          // Randomly pick `initialInUseCount` ports inside the range to
          // treat as already-bound by some sibling.
          const initial = new Set<number>();
          for (let i = 0; i < initialInUseCount; i++) {
            initial.add(start + i);
          }

          const returned = new Set<number>();
          const excluded: number[] = [...initial];
          for (let k = 0; k < K; k++) {
            const port = await scanFreePort(range, {
              excluded,
              channel: 'editor',
            });
            expect(returned.has(port)).toBe(false);
            expect(initial.has(port)).toBe(false);
            expect(port).toBeGreaterThanOrEqual(range.start);
            expect(port).toBeLessThanOrEqual(range.end);
            returned.add(port);
            excluded.push(port);
          }
          expect(returned.size).toBe(K);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('exhausting the range with excluded yields PortRangeExhaustedError whose in_use covers every port', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        async (K) => {
          const start = BASE_RANGE_START + 500;
          const end = start + K - 1;
          const range = { start, end } as const;
          const ports: number[] = [];
          for (let p = start; p <= end; p++) ports.push(p);
          try {
            await scanFreePort(range, {
              excluded: ports,
              channel: 'runtime',
            });
            throw new Error('expected throw');
          } catch (err) {
            expect(err).toBeInstanceOf(PortRangeExhaustedError);
            const e = err as PortRangeExhaustedError;
            expect(e.code).toBe(-32020);
            expect(e.data.channel).toBe('runtime');
            expect(e.data.range_start).toBe(start);
            expect(e.data.range_end).toBe(end);
            expect(e.data.in_use.sort((a, b) => a - b)).toEqual(ports);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
