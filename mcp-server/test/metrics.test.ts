/**
 * Tests for the lightweight in-memory metrics registry used by the MCP
 * server. The registry exposes two metric kinds:
 *
 *   - counter: monotonically increasing integer accumulator; `inc()` adds to
 *     it, `get()` reads the current total.
 *   - gauge: freely mutable numeric value; `set()` overwrites it, `get()`
 *     reads the last value that was set.
 *
 * Unknown metric names must read as `0` so callers can use `get()` as a
 * "read or default" accessor without first calling `inc()` / `set()`.
 */

import { describe, expect, it } from 'vitest';

import { Metrics } from '../src/metrics.js';

describe('Metrics — counters', () => {
  it('returns 0 for an unknown counter via get()', () => {
    const metrics = new Metrics();
    expect(metrics.get('mcp.reconnect.attempts')).toBe(0);
  });

  it('inc() defaults to incrementing by 1', () => {
    const metrics = new Metrics();
    metrics.inc('mcp.reconnect.attempts');
    metrics.inc('mcp.reconnect.attempts');
    expect(metrics.get('mcp.reconnect.attempts')).toBe(2);
  });

  it('inc() accepts an explicit step', () => {
    const metrics = new Metrics();
    metrics.inc('mcp.heartbeat.drops', 3);
    metrics.inc('mcp.heartbeat.drops', 2);
    expect(metrics.get('mcp.heartbeat.drops')).toBe(5);
  });

  it('counters are monotonically non-decreasing across many increments', () => {
    const metrics = new Metrics();
    let expected = 0;
    for (let i = 0; i < 100; i++) {
      metrics.inc('mcp.requests.total');
      expected += 1;
      expect(metrics.get('mcp.requests.total')).toBe(expected);
    }
  });
});

describe('Metrics — gauges', () => {
  it('returns 0 for an unknown gauge via get()', () => {
    const metrics = new Metrics();
    expect(metrics.get('mcp.reconnect.backoff_ms')).toBe(0);
  });

  it('set() writes and get() reads the same value', () => {
    const metrics = new Metrics();
    metrics.set('mcp.reconnect.backoff_ms', 4000);
    expect(metrics.get('mcp.reconnect.backoff_ms')).toBe(4000);
  });

  it('set() overwrites previous gauge values', () => {
    const metrics = new Metrics();
    metrics.set('mcp.reconnect.backoff_ms', 1000);
    metrics.set('mcp.reconnect.backoff_ms', 8000);
    metrics.set('mcp.reconnect.backoff_ms', 60000);
    expect(metrics.get('mcp.reconnect.backoff_ms')).toBe(60000);
  });
});

describe('Metrics — snapshot()', () => {
  it('returns an empty object when nothing has been recorded', () => {
    const metrics = new Metrics();
    expect(metrics.snapshot()).toEqual({});
  });

  it('includes both counters and gauges in the snapshot', () => {
    const metrics = new Metrics();
    metrics.inc('mcp.reconnect.attempts', 2);
    metrics.set('mcp.reconnect.backoff_ms', 2000);
    expect(metrics.snapshot()).toEqual({
      'mcp.reconnect.attempts': 2,
      'mcp.reconnect.backoff_ms': 2000,
    });
  });

  it('snapshot() is a detached copy; mutating it does not affect the registry', () => {
    const metrics = new Metrics();
    metrics.inc('mcp.reconnect.attempts', 1);
    const snap = metrics.snapshot();
    snap['mcp.reconnect.attempts'] = 999;
    expect(metrics.get('mcp.reconnect.attempts')).toBe(1);
  });
});

describe('Metrics — counter/gauge namespace separation', () => {
  it('rejects set() on a name that was already used as a counter', () => {
    const metrics = new Metrics();
    metrics.inc('mcp.reconnect.attempts');
    expect(() => metrics.set('mcp.reconnect.attempts', 10)).toThrowError(
      /counter/i,
    );
  });

  it('rejects inc() on a name that was already used as a gauge', () => {
    const metrics = new Metrics();
    metrics.set('mcp.reconnect.backoff_ms', 1000);
    expect(() => metrics.inc('mcp.reconnect.backoff_ms')).toThrowError(
      /gauge/i,
    );
  });
});
