/**
 * Feature: forgekit, Property 28: auth_token verification — UNAUTHORIZED for mismatched token
 *
 * Property-based test for the auth gate shared by the MCP editor
 * plugin (WebSocket) and the MCP runtime bridge (UDP). Both transports
 * call the dispatcher with a per-request token and expect the auth
 * gate to accept the request iff the token matches the configured
 * `auth_token`, otherwise produce a JSON-RPC `-32000 UNAUTHORIZED`
 * envelope and signal that the connection must be closed.
 *
 * The pure TypeScript verifier under `src/auth_verifier.ts` encodes
 * exactly that contract so the invariant can be swept with fast-check
 * from Node without spawning a headless Godot or opening a real
 * socket.
 *
 * Property:
 *   P1 — for every pair of tokens (t_req, t_cfg),
 *          t_req === t_cfg          ⇒ verifier accepts
 *                                     (ok === true, closeConnection === false)
 *          t_req !== t_cfg          ⇒ verifier rejects with
 *                                     { code: -32000, message: 'UNAUTHORIZED' }
 *                                     and closeConnection === true.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  UNAUTHORIZED_CODE,
  UNAUTHORIZED_MESSAGE,
  verifyAuthToken,
} from '../src/auth_verifier.js';

// --------------------------------------------------------------------------
// Shared constants
// --------------------------------------------------------------------------

/** Pinned iteration count for this property. */
const NUM_RUNS = 100 as const;

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

/**
 * A single token-like string. Covers empty strings, hex-style
 * random bytes and arbitrary UTF-8 — the verifier must treat every
 * value as an opaque string and compare with strict equality.
 */
const tokenArb = fc.string({ minLength: 0, maxLength: 64 });

/**
 * Pair of request/config tokens. `oneof` mixes two shapes so a single
 * `numRuns: 100` sweep exercises both branches of the contract:
 *   - `match`    — request token is identical to the configured token
 *                  (accept branch),
 *   - `mismatch` — request and configured tokens are drawn
 *                  independently (overwhelmingly the reject branch).
 */
const tokenPairArb: fc.Arbitrary<{ tReq: string; tCfg: string }> = fc.oneof(
  tokenArb.map((s) => ({ tReq: s, tCfg: s })),
  fc.tuple(tokenArb, tokenArb).map(([a, b]) => ({ tReq: a, tCfg: b })),
);

// --------------------------------------------------------------------------
// Property
// --------------------------------------------------------------------------

describe('Property 28: auth_token verification — UNAUTHORIZED for mismatched token', () => {
  it('accepts iff t_req === t_cfg; otherwise emits -32000 UNAUTHORIZED and signals connection close', () => {
    fc.assert(
      fc.property(tokenPairArb, ({ tReq, tCfg }) => {
        const result = verifyAuthToken({
          requestToken: tReq,
          configuredToken: tCfg,
        });

        if (tReq === tCfg) {
          // Accept branch: no error envelope, connection stays open.
          expect(result.ok).toBe(true);
          if (!result.ok) return; // Type-narrow for TS.
          expect(result.closeConnection).toBe(false);
        } else {
          // Reject branch: -32000 UNAUTHORIZED + close connection.
          expect(result.ok).toBe(false);
          if (result.ok) return; // Type-narrow for TS.
          expect(result.error.code).toBe(UNAUTHORIZED_CODE);
          expect(result.error.message).toBe(UNAUTHORIZED_MESSAGE);
          expect(UNAUTHORIZED_CODE).toBe(-32000);
          expect(UNAUTHORIZED_MESSAGE).toBe('UNAUTHORIZED');
          expect(result.closeConnection).toBe(true);
          // Shared error catalog guarantees a non-empty suggestion.
          expect(typeof result.error.data.suggestion).toBe('string');
          expect(result.error.data.suggestion.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
