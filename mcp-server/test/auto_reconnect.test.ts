/**
 * Tests for the MCP_Server AutoReconnect manager.
 *
 * AutoReconnect implements the exponential backoff schedule
 * `1s → 2s → 4s → 8s → 16s → 32s → 60s` (capping at 60s) and records its
 * activity through the shared Metrics registry:
 *
 *   - each `nextBackoffMs()` call increments `mcp.reconnect.attempts`;
 *   - each `nextBackoffMs()` call updates the `mcp.reconnect.backoff_ms`
 *     gauge to the delay that was just scheduled;
 *   - `onConnected()` rewinds the schedule to its first entry so the next
 *     `nextBackoffMs()` returns `1000` ms again.
 */

import { describe, expect, it } from 'vitest';

import { AutoReconnect, DEFAULT_BACKOFF_SCHEDULE_MS } from '../src/auto_reconnect.js';
import { Metrics } from '../src/metrics.js';

describe('AutoReconnect — default backoff schedule', () => {
  it('exposes the canonical schedule 1s → 2s → 4s → 8s → 16s → 32s → 60s', () => {
    expect(DEFAULT_BACKOFF_SCHEDULE_MS).toEqual([
      1000, 2000, 4000, 8000, 16000, 32000, 60000,
    ]);
  });

  it('yields the full schedule and then stays at 60s for further attempts', () => {
    const metrics = new Metrics();
    const manager = new AutoReconnect(metrics);

    const observed: number[] = [];
    for (let i = 0; i < DEFAULT_BACKOFF_SCHEDULE_MS.length + 3; i++) {
      observed.push(manager.nextBackoffMs());
    }

    expect(observed).toEqual([
      1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000,
    ]);
  });

  it('starts at schedule[0] before any attempts have been made', () => {
    const metrics = new Metrics();
    const manager = new AutoReconnect(metrics);
    expect(manager.currentBackoffMs).toBe(DEFAULT_BACKOFF_SCHEDULE_MS[0]);
  });
});

describe('AutoReconnect — metrics', () => {
  it('increments mcp.reconnect.attempts once per call', () => {
    const metrics = new Metrics();
    const manager = new AutoReconnect(metrics);

    manager.nextBackoffMs();
    manager.nextBackoffMs();
    manager.nextBackoffMs();

    expect(metrics.get('mcp.reconnect.attempts')).toBe(3);
  });

  it('records the last scheduled delay in the mcp.reconnect.backoff_ms gauge', () => {
    const metrics = new Metrics();
    const manager = new AutoReconnect(metrics);

    manager.nextBackoffMs(); // 1000
    expect(metrics.get('mcp.reconnect.backoff_ms')).toBe(1000);

    manager.nextBackoffMs(); // 2000
    expect(metrics.get('mcp.reconnect.backoff_ms')).toBe(2000);

    manager.nextBackoffMs(); // 4000
    expect(metrics.get('mcp.reconnect.backoff_ms')).toBe(4000);
  });

  it('keeps incrementing attempts even when the schedule has capped at 60s', () => {
    const metrics = new Metrics();
    const manager = new AutoReconnect(metrics);

    const totalAttempts = DEFAULT_BACKOFF_SCHEDULE_MS.length + 5;
    for (let i = 0; i < totalAttempts; i++) {
      manager.nextBackoffMs();
    }

    expect(metrics.get('mcp.reconnect.attempts')).toBe(totalAttempts);
    expect(metrics.get('mcp.reconnect.backoff_ms')).toBe(60000);
  });
});

describe('AutoReconnect — onConnected()', () => {
  it('rewinds the schedule so the next attempt returns 1000 ms', () => {
    const metrics = new Metrics();
    const manager = new AutoReconnect(metrics);

    manager.nextBackoffMs(); // 1000
    manager.nextBackoffMs(); // 2000
    manager.nextBackoffMs(); // 4000

    manager.onConnected();

    expect(manager.currentBackoffMs).toBe(1000);
    expect(manager.nextBackoffMs()).toBe(1000);
    expect(manager.nextBackoffMs()).toBe(2000);
  });

  it('does not rewind the attempts counter — attempts remain monotonic', () => {
    const metrics = new Metrics();
    const manager = new AutoReconnect(metrics);

    manager.nextBackoffMs();
    manager.nextBackoffMs();
    manager.onConnected();
    manager.nextBackoffMs();

    expect(metrics.get('mcp.reconnect.attempts')).toBe(3);
  });

  it('updates the backoff gauge back to 1000 ms once a new attempt is scheduled', () => {
    const metrics = new Metrics();
    const manager = new AutoReconnect(metrics);

    manager.nextBackoffMs(); // 1000
    manager.nextBackoffMs(); // 2000
    expect(metrics.get('mcp.reconnect.backoff_ms')).toBe(2000);

    manager.onConnected();
    manager.nextBackoffMs(); // 1000 again

    expect(metrics.get('mcp.reconnect.backoff_ms')).toBe(1000);
  });
});

describe('AutoReconnect — custom schedule', () => {
  it('honours a caller-provided schedule and still caps at its last entry', () => {
    const metrics = new Metrics();
    const manager = new AutoReconnect(metrics, [500, 1500, 5000]);

    expect(manager.nextBackoffMs()).toBe(500);
    expect(manager.nextBackoffMs()).toBe(1500);
    expect(manager.nextBackoffMs()).toBe(5000);
    expect(manager.nextBackoffMs()).toBe(5000);
    expect(manager.nextBackoffMs()).toBe(5000);
  });

  it('rejects an empty schedule', () => {
    const metrics = new Metrics();
    expect(() => new AutoReconnect(metrics, [])).toThrowError(/schedule/i);
  });
});
