/**
 * Tests for the observability metrics registry used by the health
 * endpoint and JSON-RPC dispatcher.
 *
 * The registry surface (see task 6.18):
 *   - `Counter.inc(delta?)` / `Counter.value()` — monotonically
 *     non-decreasing accumulator.
 *   - `Histogram.observe(v)` / `Histogram.snapshot()` — returns
 *     `{count, sum, p50, p95, p99}` using the nearest-rank percentile
 *     rule over a rolling window of 1000 samples.
 *   - `registerCounter(name)` / `registerHistogram(name)` — idempotent
 *     named registry; re-registering a name returns the existing
 *     instance.
 */

import { describe, expect, it } from 'vitest';

import {
  Counter,
  Histogram,
  MetricsRegistry,
} from '../../src/observability/metrics.js';

describe('Counter', () => {
  it('starts at 0', () => {
    const counter = new Counter('mcp.requests.total');
    expect(counter.value()).toBe(0);
  });

  it('inc() defaults to 1', () => {
    const counter = new Counter('mcp.requests.total');
    counter.inc();
    counter.inc();
    expect(counter.value()).toBe(2);
  });

  it('inc(delta) adds delta', () => {
    const counter = new Counter('mcp.requests.total');
    counter.inc(5);
    counter.inc(3);
    expect(counter.value()).toBe(8);
  });
});

describe('Histogram', () => {
  it('returns an empty snapshot before any observations', () => {
    const h = new Histogram('mcp.requests.duration_ms');
    const snap = h.snapshot();
    expect(snap.count).toBe(0);
    expect(snap.sum).toBe(0);
    expect(snap.p50).toBe(0);
    expect(snap.p95).toBe(0);
    expect(snap.p99).toBe(0);
  });

  it('computes nearest-rank percentiles over a fixed sample set', () => {
    const h = new Histogram('mcp.requests.duration_ms');
    for (let i = 1; i <= 100; i++) {
      h.observe(i);
    }
    const snap = h.snapshot();
    expect(snap.count).toBe(100);
    expect(snap.sum).toBe(5050);
    // Nearest-rank: ceil(p * n) / n. For n=100:
    //   p50 → sorted[49] = 50
    //   p95 → sorted[94] = 95
    //   p99 → sorted[98] = 99
    expect(snap.p50).toBe(50);
    expect(snap.p95).toBe(95);
    expect(snap.p99).toBe(99);
  });

  it('keeps a rolling window of at most 1000 samples', () => {
    const h = new Histogram('mcp.requests.duration_ms');
    // 1200 observations; only the last 1000 should be kept.
    for (let i = 0; i < 1200; i++) {
      h.observe(i);
    }
    const snap = h.snapshot();
    expect(snap.count).toBe(1000);
    // sum = 200 + 201 + ... + 1199 = (200+1199) * 1000 / 2 = 699500
    expect(snap.sum).toBe(699500);
  });
});

describe('MetricsRegistry', () => {
  it('registerCounter returns the same instance on repeated calls', () => {
    const reg = new MetricsRegistry();
    const a = reg.registerCounter('mcp.requests.total');
    const b = reg.registerCounter('mcp.requests.total');
    expect(a).toBe(b);
    a.inc();
    expect(b.value()).toBe(1);
  });

  it('registerHistogram returns the same instance on repeated calls', () => {
    const reg = new MetricsRegistry();
    const a = reg.registerHistogram('mcp.requests.duration_ms');
    const b = reg.registerHistogram('mcp.requests.duration_ms');
    expect(a).toBe(b);
    a.observe(10);
    expect(b.snapshot().count).toBe(1);
  });

  it('rejects registering a counter name as histogram (and vice-versa)', () => {
    const reg = new MetricsRegistry();
    reg.registerCounter('mcp.requests.total');
    expect(() => reg.registerHistogram('mcp.requests.total')).toThrowError(
      /counter/i,
    );
    reg.registerHistogram('mcp.requests.duration_ms');
    expect(() => reg.registerCounter('mcp.requests.duration_ms')).toThrowError(
      /histogram/i,
    );
  });

  it('listCounters() enumerates every registered counter for /metrics', () => {
    const reg = new MetricsRegistry();
    reg.registerCounter('mcp.requests.total').inc(4);
    reg.registerCounter('mcp.requests.errors').inc(1);
    const names = reg.listCounters().map(([n]) => n).sort();
    expect(names).toEqual(['mcp.requests.errors', 'mcp.requests.total']);
  });

  it('listHistograms() enumerates every registered histogram for /metrics', () => {
    const reg = new MetricsRegistry();
    reg.registerHistogram('mcp.requests.duration_ms').observe(50);
    const [[name, hist]] = reg.listHistograms();
    expect(name).toBe('mcp.requests.duration_ms');
    expect(hist!.snapshot().count).toBe(1);
  });
});
