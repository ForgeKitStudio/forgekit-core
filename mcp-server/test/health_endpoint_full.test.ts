/**
 * v0.10.0 health endpoint integration tests.
 *
 * Locks down the response shapes mandated by task 8.10:
 *
 *   GET /health   — `{status, version, uptime_s, channels: {editor, runtime},
 *                    profile, unlocked_modules, workspaces}`
 *   GET /version  — `{version, api_version, sdk_version, godot_compat,
 *                    schemas_count}`
 *   GET /metrics  — JSON cumulative stats:
 *                    `{requests_total, requests_by_method, errors_total,
 *                      errors_by_code, dispatch_latency_p50_ms,
 *                      dispatch_latency_p99_ms}`
 *   GET /trace/:trace_id — JSONL entries with the matching trace id.
 *   Unknown paths        — HTTP 404.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    MetricsRegistry,
    METRIC_REQUESTS_TOTAL,
    METRIC_REQUESTS_ERRORS,
    METRIC_REQUESTS_DURATION_MS,
} from '../src/observability/metrics.js';
import { HEALTH_RANGE } from '../src/port_scanner.js';
import {
    HealthEndpoint,
    type ChannelInfo,
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
    const tmpDir = await mkdtemp(join(tmpdir(), 'forgekit-health-full-'));
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

function memoryPersistence(): WorkspacesPersistence {
    let current: ReturnType<WorkspacesPersistence['read']> extends Promise<infer R>
        ? R
        : never = null;
    return {
        async read() {
            return current;
        },
        async write(snapshot) {
            current = snapshot;
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

describe('HealthEndpoint v0.10.0 — GET /health', () => {
    it('returns the v0.10.0 schema with status, version, uptime_s, channels, profile, unlocked_modules, workspaces', async () => {
        const registry = new ProjectRegistry(
            memoryPersistence(),
            fakeFs(new Set(['/proj-a', '/proj-b'])),
            () => '2026-05-09T19:30:00.000Z',
        );
        await registry.register({ workspace_id: 'a', projectRoot: '/proj-a' });
        await registry.register({ workspace_id: 'b', projectRoot: '/proj-b' });
        await registry.setActive('b');

        const channelInfo: { editor: ChannelInfo; runtime: ChannelInfo } = {
            editor: { connected: true, port: 6011, last_heartbeat_ms_ago: 1500 },
            runtime: { connected: false, port: null, last_heartbeat_ms_ago: null },
        };

        env.server = new HealthEndpoint({
            metrics: new MetricsRegistry(),
            activePortFilePath: env.activePortFile,
            logsDir: env.logsDir,
            coreVersionResolver: async () => 'v0.10.0',
            serverVersion: '0.10.0',
            channelStatusProvider: () => ({ editor: 'ok', runtime: 'down', cli: 'ok' }),
            channelInfoProvider: () => channelInfo,
            profile: 'Full',
            unlockedModules: ['combat', 'crafting', 'inventory'],
            registry,
        });
        await env.server.start();

        const { status, body } = await fetchJson(
            `http://127.0.0.1:${env.server.getPort()}/health`,
        );
        expect(status).toBe(200);
        const b = body as Record<string, unknown>;

        expect(b.status).toBe('down');
        expect(b.version).toBe('0.10.0');
        expect(typeof b.uptime_s).toBe('number');
        expect((b.uptime_s as number) >= 0).toBe(true);
        expect(b.channels).toEqual({
            editor: { connected: true, port: 6011, last_heartbeat_ms_ago: 1500 },
            runtime: { connected: false, port: null, last_heartbeat_ms_ago: null },
        });
        expect(b.profile).toBe('Full');
        expect(b.unlocked_modules).toEqual(['combat', 'crafting', 'inventory']);
        expect(b.workspaces).toEqual({ count: 2, active: 'b' });
    });

    it('reports uptime_s growing monotonically across requests', async () => {
        let now = 1_000_000;
        const clock = () => new Date(now);
        env.server = new HealthEndpoint({
            metrics: new MetricsRegistry(),
            activePortFilePath: env.activePortFile,
            logsDir: env.logsDir,
            coreVersionResolver: async () => 'unknown',
            serverVersion: '0.10.0',
            channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
            clock,
        });
        await env.server.start();

        const url = `http://127.0.0.1:${env.server.getPort()}/health`;
        const first = (await fetchJson(url)).body as Record<string, unknown>;
        expect(first.uptime_s).toBe(0);

        now += 5_000;
        const second = (await fetchJson(url)).body as Record<string, unknown>;
        expect(second.uptime_s).toBe(5);

        now += 12_000;
        const third = (await fetchJson(url)).body as Record<string, unknown>;
        expect(third.uptime_s).toBe(17);
    });
});

describe('HealthEndpoint v0.10.0 — GET /version', () => {
    it('returns version, api_version, sdk_version, godot_compat, schemas_count', async () => {
        env.server = new HealthEndpoint({
            metrics: new MetricsRegistry(),
            activePortFilePath: env.activePortFile,
            logsDir: env.logsDir,
            coreVersionResolver: async () => 'v0.10.0',
            serverVersion: '0.10.0',
            channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
            apiVersion: '0.10.0',
            sdkVersion: '@modelcontextprotocol/sdk@1.29.0',
            godotCompat: ['4.3+'],
            schemasCount: 215,
        });
        await env.server.start();

        const { status, body } = await fetchJson(
            `http://127.0.0.1:${env.server.getPort()}/version`,
        );
        expect(status).toBe(200);
        const b = body as Record<string, unknown>;
        expect(b.version).toBe('0.10.0');
        expect(b.api_version).toBe('0.10.0');
        expect(b.sdk_version).toBe('@modelcontextprotocol/sdk@1.29.0');
        expect(b.godot_compat).toEqual(['4.3+']);
        expect(b.schemas_count).toBe(215);
    });
});

describe('HealthEndpoint v0.10.0 — GET /metrics', () => {
    it('returns JSON cumulative stats with requests/errors totals and dispatch latency percentiles', async () => {
        const metrics = new MetricsRegistry();
        metrics.registerCounter(METRIC_REQUESTS_TOTAL).inc(50);
        metrics.registerCounter(METRIC_REQUESTS_ERRORS).inc(7);
        const histogram = metrics.registerHistogram(METRIC_REQUESTS_DURATION_MS);
        for (let i = 1; i <= 100; i++) {
            histogram.observe(i);
        }

        env.server = new HealthEndpoint({
            metrics,
            activePortFilePath: env.activePortFile,
            logsDir: env.logsDir,
            coreVersionResolver: async () => 'unknown',
            serverVersion: '0.10.0',
            channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
            metricsSnapshotProvider: () => ({
                requests_total: 50,
                requests_by_method: { 'scene.open': 30, 'node.add': 20 },
                errors_total: 7,
                errors_by_code: { '-32601': 4, '-32602': 3 },
                dispatch_latency_p50_ms: 50,
                dispatch_latency_p99_ms: 99,
            }),
        });
        await env.server.start();

        const { status, body } = await fetchJson(
            `http://127.0.0.1:${env.server.getPort()}/metrics`,
        );
        expect(status).toBe(200);
        expect(body).toEqual({
            requests_total: 50,
            requests_by_method: { 'scene.open': 30, 'node.add': 20 },
            errors_total: 7,
            errors_by_code: { '-32601': 4, '-32602': 3 },
            dispatch_latency_p50_ms: 50,
            dispatch_latency_p99_ms: 99,
        });
    });

    it('falls back to MetricsRegistry-derived defaults when no snapshot provider is supplied', async () => {
        const metrics = new MetricsRegistry();
        metrics.registerCounter(METRIC_REQUESTS_TOTAL).inc(11);
        metrics.registerCounter(METRIC_REQUESTS_ERRORS).inc(2);
        const histogram = metrics.registerHistogram(METRIC_REQUESTS_DURATION_MS);
        for (let i = 1; i <= 100; i++) {
            histogram.observe(i);
        }

        env.server = new HealthEndpoint({
            metrics,
            activePortFilePath: env.activePortFile,
            logsDir: env.logsDir,
            coreVersionResolver: async () => 'unknown',
            serverVersion: '0.10.0',
            channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
        });
        await env.server.start();

        const { status, body } = await fetchJson(
            `http://127.0.0.1:${env.server.getPort()}/metrics`,
        );
        expect(status).toBe(200);
        const b = body as Record<string, unknown>;
        expect(b.requests_total).toBe(11);
        expect(b.errors_total).toBe(2);
        expect(b.requests_by_method).toEqual({});
        expect(b.errors_by_code).toEqual({});
        expect(b.dispatch_latency_p50_ms).toBe(50);
        expect(b.dispatch_latency_p99_ms).toBe(99);
    });
});

describe('HealthEndpoint v0.10.0 — GET /trace/:trace_id', () => {
    it('returns JSONL entries from logsDir filtered by trace_id', async () => {
        const day = '2026-06-10';
        const path = join(env.logsDir, `${day}.jsonl`);
        const lines = [
            { ts: '2026-06-10T12:00:00.000Z', trace_id: 'tid-one', method: 'scene.open' },
            { ts: '2026-06-10T12:00:01.000Z', trace_id: 'tid-other', method: 'node.add' },
            { ts: '2026-06-10T12:00:02.000Z', trace_id: 'tid-one', method: 'editor.save' },
        ];
        await writeFile(
            path,
            lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
            'utf8',
        );

        env.server = new HealthEndpoint({
            metrics: new MetricsRegistry(),
            activePortFilePath: env.activePortFile,
            logsDir: env.logsDir,
            coreVersionResolver: async () => 'unknown',
            serverVersion: '0.10.0',
            channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
            clock: () => new Date('2026-06-10T23:00:00.000Z'),
        });
        await env.server.start();

        const { status, body } = await fetchJson(
            `http://127.0.0.1:${env.server.getPort()}/trace/tid-one`,
        );
        expect(status).toBe(200);
        const arr = body as Array<Record<string, unknown>>;
        expect(arr).toHaveLength(2);
        expect(arr[0]!.method).toBe('scene.open');
        expect(arr[1]!.method).toBe('editor.save');
    });
});

describe('HealthEndpoint v0.10.0 — unknown paths', () => {
    it('returns 404 for paths that do not match any registered route', async () => {
        env.server = new HealthEndpoint({
            metrics: new MetricsRegistry(),
            activePortFilePath: env.activePortFile,
            logsDir: env.logsDir,
            coreVersionResolver: async () => 'unknown',
            serverVersion: '0.10.0',
            channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
        });
        await env.server.start();

        const url = `http://127.0.0.1:${env.server.getPort()}/does-not-exist`;
        const response = await fetch(url);
        expect(response.status).toBe(404);
    });

    it('returns 404 for nested unknown paths', async () => {
        env.server = new HealthEndpoint({
            metrics: new MetricsRegistry(),
            activePortFilePath: env.activePortFile,
            logsDir: env.logsDir,
            coreVersionResolver: async () => 'unknown',
            serverVersion: '0.10.0',
            channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
        });
        await env.server.start();

        const url = `http://127.0.0.1:${env.server.getPort()}/api/healthz`;
        const response = await fetch(url);
        expect(response.status).toBe(404);
    });
});

describe('HealthEndpoint v0.10.0 — port scan keeps active port file invariants', () => {
    it('binds within HEALTH_RANGE and merges the chosen port under the "health" key', async () => {
        env.server = new HealthEndpoint({
            metrics: new MetricsRegistry(),
            activePortFilePath: env.activePortFile,
            logsDir: env.logsDir,
            coreVersionResolver: async () => 'unknown',
            serverVersion: '0.10.0',
            channelStatusProvider: () => ({ editor: 'ok', runtime: 'ok', cli: 'ok' }),
        });
        await env.server.start();

        const port = env.server.getPort();
        expect(port).toBeGreaterThanOrEqual(HEALTH_RANGE.start);
        expect(port).toBeLessThanOrEqual(HEALTH_RANGE.end);
        const { readFile } = await import('node:fs/promises');
        const raw = await readFile(env.activePortFile, 'utf8');
        expect(JSON.parse(raw).health).toBe(port);
    });
});
