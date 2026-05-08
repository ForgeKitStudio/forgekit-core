/**
 * Feature: forgekit, Property 17: UDP rejects packets above the size limit
 *
 * Property-based test for the size gate on the MCP runtime bridge's
 * UDP packet parser. The gate mirrors the GDScript producer shipped in
 * `addons/forgekit_core/mcp/runtime_bridge/packet_parser.gd`: every
 * incoming datagram is measured before any decode step, and any
 * datagram whose byte length exceeds `max_packet_bytes` (default
 * 65507 — the IPv4 UDP payload ceiling) is rejected with a JSON-RPC
 * `-32005 PACKET_TOO_LARGE` envelope carrying `data.size` (the actual
 * datagram length) and `data.limit` (the configured maximum).
 *
 * The TypeScript port under `src/tools/runtime_bridge/packet_parser.ts`
 * is the system under test: it encodes exactly the size-gate portion
 * of the GDScript parser's contract so the same invariant can be
 * swept with fast-check from Node without spawning a headless Godot.
 *
 * Property:
 *   P1 — for every generated `s > 65507`, a datagram of length `s`
 *        is rejected with `code === -32005`,
 *        `message === 'PACKET_TOO_LARGE'`, `data.size === s`, and
 *        `data.limit === 65507`.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_PACKET_BYTES,
  PACKET_TOO_LARGE_CODE,
  PACKET_TOO_LARGE_MESSAGE,
  parsePacketSize,
} from '../src/tools/runtime_bridge/packet_parser.js';

// --------------------------------------------------------------------------
// Shared constants
// --------------------------------------------------------------------------

/** Pinned iteration count for this property. */
const NUM_RUNS = 100 as const;

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

/**
 * Datagram byte-length strictly above the IPv4 UDP payload ceiling
 * (65507). Upper bound at 2_000_000 keeps the sweep wide enough to
 * cover multi-megabyte payloads without allocating real buffers for
 * every iteration.
 */
const oversizedSizeArb = fc.integer({ min: 65_508, max: 2_000_000 });

// --------------------------------------------------------------------------
// Property
// --------------------------------------------------------------------------

describe('Property 17: UDP rejects packets above the size limit', () => {
  it('every size s > 65507 is rejected with -32005 PACKET_TOO_LARGE carrying data.size == s and data.limit == 65507', () => {
    fc.assert(
      fc.property(oversizedSizeArb, (size) => {
        const result = parsePacketSize(size);

        expect(result.ok).toBe(false);
        if (result.ok) return; // Type-narrow for TS; unreachable after the assert above.

        expect(result.error.code).toBe(PACKET_TOO_LARGE_CODE);
        expect(result.error.message).toBe(PACKET_TOO_LARGE_MESSAGE);
        expect(result.error.data.size).toBe(size);
        expect(result.error.data.limit).toBe(DEFAULT_MAX_PACKET_BYTES);
        expect(DEFAULT_MAX_PACKET_BYTES).toBe(65_507);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
