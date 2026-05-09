/**
 * Tests for the MCP health endpoint HTTP server.
 *
 * The server binds the first free TCP port in the Health range
 * (`6040-6049`) on `127.0.0.1` and exposes four routes:
 *
 *   GET /health           — status summary per channel.
 *   GET /metrics          — Prometheus-style text render.
 *   GET /version          — server version + Core git tag + api version.
 *   GET /trace/:trace_id  — last 100 JSONL entries with that trace id.
 *
 * The chosen port is merged into `<activePortFilePath>` under the
 * `"health"` key so the editor plugin / runtime bridge can discover
 * it in the same way as the other active ports.
 */

import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MetricsRegistry,
} from '../src/observability/metrics.js';
import { HEALTH_RANGE } from '../src/port_scanner.js';
import {
  HealthEndpoint,
  type ChannelName,
} from '../src/health_endpoint.js';
import { ProjectRegistry } from '../src/projects/registry.js';
import type { FileSystemAdapter } from '../src/projects/registry.js';
import type { WorkspacesPersistence } from '../src/projects/persistence.js';

interface TestEnv {
  tmpDir: string;
  activePortFile: string;
  logsDir: string;
  server: HealthEndpoint | null;
}

async function newEnv(): Promise<TestEnv> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'forgekit-health-'));
  await mkdir(join(tmpDir, 'logs'), { recursive: true });
  return {
    tmpDir,
    activePortFile: join(tmpDir, 'mcp_active_port.json'),
    logsDir: join(tmpDir, 'logs'),
    server: null,
  };
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url);
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.text() };
}

let env: TestEnv;

beforeEach(async () => {
  env = await newEnv();
});

afterEach(async () => {
  if (env.server) {
    await env.server.stop();
    env.server = null;
  }
  await rm(env.tmpDir, { recursive: true, force: true });
});

describe('HealthEndpoint — port scan + active file', () => {
  it('binds the first free port in 6040-6049 and writes it under "health"', async () => {
    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'unknown',
      serverVersion: '0.7.0',
      channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
    });
    await env.server.start();

    const port = env.server.getPort();
    expect(port).toBeGreaterThanOrEqual(HEALTH_RANGE.start);
    expect(port).toBeLessThanOrEqual(HEALTH_RANGE.end);

    const raw = await readFile(env.activePortFile, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.health).toBe(port);
  });

  it('preserves existing active-port keys when writing the health port', async () => {
    await writeFile(
      env.activePortFile,
      JSON.stringify({ editor: 6011, runtime: 6022, visualizer: 6033 }, null, 2),
      'utf8',
    );
    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'unknown',
      serverVersion: '0.7.0',
      channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
    });
    await env.server.start();

    const raw = await readFile(env.activePortFile, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.editor).toBe(6011);
    expect(parsed.runtime).toBe(6022);
    expect(parsed.visualizer).toBe(6033);
    expect(parsed.health).toBe(env.server.getPort());
  });
});

describe('HealthEndpoint — GET /health', () => {
  it('returns {status: "ok", checks: {editor, runtime, cli}} when all channels are fresh', async () => {
    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'unknown',
      serverVersion: '0.7.0',
      channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
    });
    await env.server.start();

    const url = `http://127.0.0.1:${env.server.getPort()}/health`;
    const { status, body } = await fetchJson(url);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).status).toBe('ok');
    expect((body as Record<string, unknown>).checks).toEqual({
      editor: 'ok',
      runtime: 'ok',
      cli: 'ok',
    });
  });

  it('returns {status: "degraded"} when any channel reports degraded', async () => {
    let editorStatus: ChannelName = 'ok';
    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'unknown',
      serverVersion: '0.7.0',
      channelStatusProvider: () => ({
        editor: editorStatus,
        runtime: 'ok',
        cli: 'ok',
      }),
    });
    await env.server.start();

    editorStatus = 'degraded';
    const { body } = await fetchJson(`http://127.0.0.1:${env.server.getPort()}/health`);
    expect((body as Record<string, unknown>).status).toBe('degraded');
  });

  it('returns {status: "down"} when any channel reports down', async () => {
    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'unknown',
      serverVersion: '0.7.0',
      channelStatusProvider: () => ({
        editor: 'ok',
        runtime: 'down',
        cli: 'ok',
      }),
    });
    await env.server.start();

    const { body } = await fetchJson(`http://127.0.0.1:${env.server.getPort()}/health`);
    expect((body as Record<string, unknown>).status).toBe('down');
  });
});

describe('HealthEndpoint — GET /metrics', () => {
  it('renders counter and histogram values in Prometheus text format', async () => {
    const metrics = new MetricsRegistry();
    metrics.registerCounter('mcp.requests.total').inc(42);
    metrics.registerCounter('mcp.requests.errors').inc(3);
    const h = metrics.registerHistogram('mcp.requests.duration_ms');
    for (let i = 1; i <= 100; i++) {
      h.observe(i);
    }

    env.server = new HealthEndpoint({
      metrics,
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'unknown',
      serverVersion: '0.7.0',
      channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
    });
    await env.server.start();

    const url = `http://127.0.0.1:${env.server.getPort()}/metrics`;
    const { status, body } = await fetchText(url);
    expect(status).toBe(200);
    // Counters.
    expect(body).toContain('# TYPE mcp_requests_total counter');
    expect(body).toContain('mcp_requests_total 42');
    expect(body).toContain('mcp_requests_errors 3');
    // Histograms have both sum / count and quantile lines.
    expect(body).toContain('# TYPE mcp_requests_duration_ms histogram');
    expect(body).toContain('mcp_requests_duration_ms_count 100');
    expect(body).toContain('mcp_requests_duration_ms_sum 5050');
    expect(body).toContain('mcp_requests_duration_ms{quantile="0.5"} 50');
    expect(body).toContain('mcp_requests_duration_ms{quantile="0.95"} 95');
    expect(body).toContain('mcp_requests_duration_ms{quantile="0.99"} 99');
  });
});

describe('HealthEndpoint — GET /version', () => {
  it('returns {server, core_detected, api_version}', async () => {
    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'v0.7.0',
      serverVersion: '0.7.0',
      channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
    });
    await env.server.start();

    const { body } = await fetchJson(`http://127.0.0.1:${env.server.getPort()}/version`);
    expect(body).toEqual({
      server: '0.7.0',
      core_detected: 'v0.7.0',
      api_version: '0.7.0',
    });
  });

  it('falls back to "unknown" when the core resolver fails', async () => {
    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => {
        throw new Error('git describe failed');
      },
      serverVersion: '0.7.0',
      channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
    });
    await env.server.start();

    const { body } = await fetchJson(`http://127.0.0.1:${env.server.getPort()}/version`);
    expect((body as Record<string, unknown>).core_detected).toBe('unknown');
  });
});

describe('HealthEndpoint — GET /trace/:trace_id', () => {
  it('returns up to 100 JSONL entries filtered by trace_id, sorted by ts asc', async () => {
    // Seed two days of logs with interleaved trace_ids.
    const day1 = '2026-05-15';
    const day2 = '2026-05-16';
    const write = async (date: string, entries: Array<Record<string, unknown>>) => {
      const path = join(env.logsDir, `${date}.jsonl`);
      const body = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await writeFile(path, body, 'utf8');
    };
    await write(day1, [
      { ts: '2026-05-15T12:00:00.000Z', trace_id: 'aabbccdd', msg: '1' },
      { ts: '2026-05-15T12:00:01.000Z', trace_id: 'other', msg: 'ignored' },
    ]);
    await write(day2, [
      { ts: '2026-05-16T09:00:00.000Z', trace_id: 'aabbccdd', msg: '2' },
      { ts: '2026-05-16T09:00:01.000Z', trace_id: 'aabbccdd', msg: '3' },
    ]);

    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'unknown',
      serverVersion: '0.7.0',
      channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
      clock: () => new Date('2026-05-16T23:00:00.000Z'),
    });
    await env.server.start();

    const { status, body } = await fetchJson(
      `http://127.0.0.1:${env.server.getPort()}/trace/aabbccdd`,
    );
    expect(status).toBe(200);
    const arr = body as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(3);
    expect(arr[0]!.msg).toBe('1');
    expect(arr[1]!.msg).toBe('2');
    expect(arr[2]!.msg).toBe('3');
  });

  it('caps the response at 100 entries', async () => {
    const entries = Array.from({ length: 150 }, (_, i) => ({
      ts: `2026-05-16T12:00:${String(i).padStart(2, '0')}.000Z`,
      trace_id: 'aabbccdd',
      i,
    }));
    const path = join(env.logsDir, '2026-05-16.jsonl');
    await writeFile(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'unknown',
      serverVersion: '0.7.0',
      channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
      clock: () => new Date('2026-05-16T23:00:00.000Z'),
    });
    await env.server.start();

    const { body } = await fetchJson(
      `http://127.0.0.1:${env.server.getPort()}/trace/aabbccdd`,
    );
    const arr = body as Array<Record<string, unknown>>;
    expect(arr.length).toBe(100);
  });
});

describe('HealthEndpoint — GET /health with workspaces field (Phase 7)', () => {
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
  function fakeFs(roots: ReadonlySet<string>): FileSystemAdapter {
    return {
      isAbsolute: (p) => p.startsWith('/'),
      isDirectory: async (p) => roots.has(p),
      hasProjectGodot: async (p) => roots.has(p),
    };
  }

  it('returns workspaces: {count, active} summarising the ProjectRegistry', async () => {
    const registry = new ProjectRegistry(
      memoryPersistence(),
      fakeFs(new Set(['/a', '/b'])),
      () => '2026-05-09T19:30:00.000Z',
    );
    await registry.register({ workspace_id: 'a', projectRoot: '/a' });
    await registry.register({ workspace_id: 'b', projectRoot: '/b' });
    await registry.setActive('b');

    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'unknown',
      serverVersion: '0.9.0',
      channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
      registry,
    });
    await env.server.start();

    const { status, body } = await fetchJson(
      `http://127.0.0.1:${env.server.getPort()}/health`,
    );
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.workspaces).toEqual({ count: 2, active: 'b' });
  });

  it('returns workspaces: {count: 0, active: null} for an empty registry', async () => {
    const registry = new ProjectRegistry(
      memoryPersistence(),
      fakeFs(new Set()),
    );

    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'unknown',
      serverVersion: '0.9.0',
      channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
      registry,
    });
    await env.server.start();

    const { body } = await fetchJson(
      `http://127.0.0.1:${env.server.getPort()}/health`,
    );
    const b = body as Record<string, unknown>;
    expect(b.workspaces).toEqual({ count: 0, active: null });
  });

  it('omits the workspaces field when no registry is injected (backwards compat)', async () => {
    env.server = new HealthEndpoint({
      metrics: new MetricsRegistry(),
      activePortFilePath: env.activePortFile,
      logsDir: env.logsDir,
      coreVersionResolver: async () => 'unknown',
      serverVersion: '0.9.0',
      channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
    });
    await env.server.start();

    const { body } = await fetchJson(
      `http://127.0.0.1:${env.server.getPort()}/health`,
    );
    const b = body as Record<string, unknown>;
    expect(b.workspaces).toBeUndefined();
  });
});

describe('HealthEndpoint — port exhaustion', () => {
  it('reports RangeExhaustedError when every port in 6040-6049 is occupied', async () => {
    const servers: Array<ReturnType<typeof createServer>> = [];
    try {
      for (let port = HEALTH_RANGE.start; port <= HEALTH_RANGE.end; port++) {
        const s = createServer();
        await new Promise<void>((resolve, reject) => {
          s.once('error', reject);
          s.listen(port, '127.0.0.1', () => resolve());
        });
        servers.push(s);
      }

      const endpoint = new HealthEndpoint({
        metrics: new MetricsRegistry(),
        activePortFilePath: env.activePortFile,
        logsDir: env.logsDir,
        coreVersionResolver: async () => 'unknown',
        serverVersion: '0.7.0',
        channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
      });
      await expect(endpoint.start()).rejects.toThrow(/PORT_RANGE_EXHAUSTED|occupied/i);
    } finally {
      await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    }
  });
});
