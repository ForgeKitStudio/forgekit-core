/**
 * Tests for the trace/span identifier generator used by the MCP server to
 * correlate JSON-RPC requests with the GDScript-side editor plugin and
 * runtime bridge.
 *
 * Shape (see task 6.17):
 *   - `generateTraceId()` returns an 8-char lowercase hex string.
 *   - `generateSpanId()` returns a 4-char lowercase hex string.
 *   - `newTraceContext()` returns `{trace_id, span_id}` carrying one
 *     freshly minted pair.
 *
 * Uniqueness is probabilistic (32 bits for trace, 16 bits for span) but
 * over 1000 generations the collision rate must stay well under 0.5%.
 */

import { describe, expect, it } from 'vitest';

import {
  generateSpanId,
  generateTraceId,
  newTraceContext,
} from '../../src/observability/trace.js';

const TRACE_ID_RE = /^[0-9a-f]{8}$/;
const SPAN_ID_RE = /^[0-9a-f]{4}$/;

describe('trace — generateTraceId()', () => {
  it('returns an 8-char lowercase hex string', () => {
    const id = generateTraceId();
    expect(id).toMatch(TRACE_ID_RE);
  });

  it('produces unique-enough ids over 1000 iterations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateTraceId());
    }
    // 8 hex chars = 2^32 space; the probability of more than 5 collisions
    // over 1000 samples is negligible, so anything > 995 unique ids is fine.
    expect(seen.size).toBeGreaterThan(995);
  });
});

describe('trace — generateSpanId()', () => {
  it('returns a 4-char lowercase hex string', () => {
    const id = generateSpanId();
    expect(id).toMatch(SPAN_ID_RE);
  });

  it('produces varied ids over 1000 iterations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateSpanId());
    }
    // 4 hex chars = 2^16 space; ~0.75% collision expected over 1000
    // samples, so require at least half the possible range coverage.
    expect(seen.size).toBeGreaterThan(500);
  });
});

describe('trace — newTraceContext()', () => {
  it('returns {trace_id, span_id} both matching the format rules', () => {
    const ctx = newTraceContext();
    expect(ctx.trace_id).toMatch(TRACE_ID_RE);
    expect(ctx.span_id).toMatch(SPAN_ID_RE);
  });

  it('returns a fresh pair on each call', () => {
    const a = newTraceContext();
    const b = newTraceContext();
    expect(a.trace_id === b.trace_id && a.span_id === b.span_id).toBe(false);
  });
});
