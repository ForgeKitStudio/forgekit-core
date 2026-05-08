/**
 * Feature: forgekit, Property 29: EXTERNAL_BIND_ENABLED warning for non-loopback bind_address
 *
 * Property-based test for the start-time safety warning shared by the
 * MCP editor plugin (WebSocket) and the MCP runtime bridge (UDP).
 * Both transports measure the configured `bind_address` against the
 * loopback default (`127.0.0.1`); a non-loopback value still starts
 * the server but appends a warning carrying the code
 * `EXTERNAL_BIND_ENABLED` and the offending `bind_address` so the
 * operator knows MCP traffic is now reachable beyond the local host.
 *
 * The pure TypeScript producer under `src/bind_warning.ts` encodes
 * exactly that contract so the invariant can be swept with fast-check
 * from Node without spawning a headless Godot or opening a real
 * socket.
 *
 * Property:
 *   P1 — for every generated `bind_address` drawn from `fc.ipV4()` and
 *        filtered to `!== "127.0.0.1"`, the warnings array produced at
 *        server start SHALL contain at least one entry whose `code`
 *        equals `"EXTERNAL_BIND_ENABLED"` and whose `bind_address`
 *        equals the configured value.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_BIND_ENABLED_CODE,
  LOOPBACK_BIND_ADDRESS,
  buildStartupWarnings,
} from '../src/bind_warning.js';

// --------------------------------------------------------------------------
// Shared constants
// --------------------------------------------------------------------------

/** Pinned iteration count for this property. */
const NUM_RUNS = 100 as const;

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

/**
 * Any syntactically valid IPv4 address other than the loopback
 * default. Covers private ranges (192.168.x.x, 10.x.x.x), link-local
 * (169.254.x.x), public unicast, broadcast (255.255.255.255), and the
 * unspecified address (0.0.0.0) — every shape is a non-loopback
 * bind_address from the producer's point of view.
 */
const nonLoopbackBindAddressArb: fc.Arbitrary<string> = fc
  .ipV4()
  .filter((ip) => ip !== LOOPBACK_BIND_ADDRESS);

// --------------------------------------------------------------------------
// Property
// --------------------------------------------------------------------------

describe('Property 29: EXTERNAL_BIND_ENABLED warning for non-loopback bind_address', () => {
  it('emits a warning with code EXTERNAL_BIND_ENABLED carrying the configured bind_address for every non-loopback address', () => {
    fc.assert(
      fc.property(nonLoopbackBindAddressArb, (bindAddress) => {
        const warnings = buildStartupWarnings({ bindAddress });

        const match = warnings.find(
          (w) =>
            w.code === EXTERNAL_BIND_ENABLED_CODE &&
            w.bind_address === bindAddress,
        );

        expect(match).toBeDefined();
        expect(EXTERNAL_BIND_ENABLED_CODE).toBe('EXTERNAL_BIND_ENABLED');
        expect(LOOPBACK_BIND_ADDRESS).toBe('127.0.0.1');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
