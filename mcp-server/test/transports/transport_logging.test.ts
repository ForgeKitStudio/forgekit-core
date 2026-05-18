/**
 * Tests for transport-side JSONL logging.
 *
 * Both `EditorWsClient` and `RuntimeUdpClient` accept an optional
 * `logger` parameter. When present, every `send(method, params)` call
 * emits one JSONL line per outgoing message and one per response,
 * carrying the `trace.{trace_id, span_id}` context attached to
 * `params` by the dispatcher's logging middleware.
 *
 * The component name written into each line distinguishes the
 * transport: `editor_ws_client` for the WebSocket bridge and
 * `runtime_udp_client` for the UDP bridge. Tests point each transport's
 * `JsonlLogger` at its own tmp `baseDir` and read the resulting
 * `<baseDir>/<YYYY-MM-DD>.jsonl` file.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as dgram from 'node:dgram';

import { JsonlLogger } from '../../src/observability/jsonl_logger.js';
import { Metrics } from '../../src/metrics.js';
import { RuntimeUdpClient } from '../../src/transports/runtime_udp_client.js';
import { EditorWsClient } from '../../src/transports/editor_ws_client.js';
import { WebSocketServer } from 'ws';

interface RecordedDatagram {
    req: {
        method?: string;
        params?: { trace?: { trace_id?: string; span_id?: string } };
        id?: number;
    };
    rinfo: dgram.RemoteInfo;
}

interface MockUdpHandle {
    server: dgram.Socket;
    port: number;
    received: RecordedDatagram[];
    close: () => Promise<void>;
}

async function startMockUdpServer(): Promise<MockUdpHandle> {
    const server = dgram.createSocket('udp4');
    const received: RecordedDatagram[] = [];
    server.on('message', (msg, rinfo) => {
        const text = msg.toString('utf8');
        const parsed = JSON.parse(text) as RecordedDatagram['req'];
        received.push({ req: parsed, rinfo });
        // Echo a successful reply with the same id.
        const reply = {
            jsonrpc: '2.0',
            id: parsed.id ?? null,
            result: { ok: true },
        };
        server.send(Buffer.from(JSON.stringify(reply), 'utf8'), rinfo.port, rinfo.address);
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.bind(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            resolve();
        });
    });
    const port = (server.address() as { port: number }).port;
    return {
        server,
        port,
        received,
        close: () =>
            new Promise<void>((r) => {
                try {
                    server.close(() => r());
                } catch {
                    r();
                }
            }),
    };
}

describe('RuntimeUdpClient — JSONL logging', () => {
    let server: MockUdpHandle;
    let baseDir: string;

    beforeEach(async () => {
        server = await startMockUdpServer();
        baseDir = await mkdtemp(join(tmpdir(), 'forgekit-runtime-log-'));
    });

    afterEach(async () => {
        await server.close();
        await rm(baseDir, { recursive: true, force: true });
    });

    it('writes one outbound and one inbound log line per send()', async () => {
        const logger = new JsonlLogger({
            baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
            logger,
        });
        await client.connect();
        await client.send('combat.spawn_enemy', {
            position: { x: 1, y: 2 },
            trace: { trace_id: 'aabbccdd', span_id: '1234' },
        });
        client.disconnect();

        const file = join(baseDir, '2026-08-01.jsonl');
        const raw = await readFile(file, 'utf8');
        const lines = raw
            .split('\n')
            .filter((l) => l !== '')
            .map((l) => JSON.parse(l) as Record<string, unknown>);
        // Filter to the actual send (skip handshake-related lines if any).
        const traced = lines.filter((l) => l.trace_id === 'aabbccdd');
        expect(traced.length).toBeGreaterThanOrEqual(2);
        const outbound = traced.find(
            (l) => (l.data as Record<string, unknown> | undefined)?.direction === 'outbound',
        );
        const inbound = traced.find(
            (l) => (l.data as Record<string, unknown> | undefined)?.direction === 'inbound',
        );
        expect(outbound).toBeDefined();
        expect(inbound).toBeDefined();
        expect(outbound!.method).toBe('combat.spawn_enemy');
        expect(inbound!.method).toBe('combat.spawn_enemy');
        expect(outbound!.span_id).toBe('1234');
        expect(inbound!.span_id).toBe('1234');
        expect(outbound!.component).toBe('runtime_udp_client');
        expect(inbound!.component).toBe('runtime_udp_client');
    });

    it('mints a fresh trace context when params.trace is absent', async () => {
        const logger = new JsonlLogger({
            baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
            logger,
        });
        await client.connect();
        await client.send('inventory.add_item', { item_id: 'sword' });
        client.disconnect();

        const file = join(baseDir, '2026-08-01.jsonl');
        const raw = await readFile(file, 'utf8');
        const lines = raw
            .split('\n')
            .filter((l) => l !== '')
            .map((l) => JSON.parse(l) as Record<string, unknown>);
        const send = lines.find((l) => l.method === 'inventory.add_item');
        expect(send).toBeDefined();
        expect(send!.trace_id).toMatch(/^[0-9a-f]{8}$/);
        expect(send!.span_id).toMatch(/^[0-9a-f]{4}$/);
    });
});

describe('EditorWsClient — JSONL logging', () => {
    let wss: WebSocketServer;
    let port: number;
    let baseDir: string;

    beforeEach(async () => {
        wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
        await new Promise<void>((r) => wss.once('listening', () => r()));
        const addr = wss.address();
        if (typeof addr === 'string' || addr === null) {
            throw new Error('Mock WS server did not bind.');
        }
        port = addr.port;
        wss.on('connection', (ws) => {
            ws.on('message', (raw) => {
                const text = typeof raw === 'string' ? raw : raw.toString('utf8');
                let parsed: { id?: number };
                try {
                    parsed = JSON.parse(text) as { id?: number };
                } catch {
                    return;
                }
                ws.send(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { ok: true } }));
            });
        });
        baseDir = await mkdtemp(join(tmpdir(), 'forgekit-editor-log-'));
    });

    afterEach(async () => {
        await new Promise<void>((r) => wss.close(() => r()));
        await rm(baseDir, { recursive: true, force: true });
    });

    it('writes outbound and inbound log lines per send() with reused trace_id', async () => {
        const logger = new JsonlLogger({
            baseDir,
            level: 'debug',
            clock: () => new Date('2026-08-01T12:00:00.000Z'),
        });
        const metrics = new Metrics();
        const client = new EditorWsClient({
            metrics,
            host: '127.0.0.1',
            range: { start: port, end: port },
            tcpProbe: async (_h, p) => p === port,
            enableHeartbeat: false,
            enableAutoReconnect: false,
            logger,
        });
        await client.connect();
        await client.send('scene.open', {
            path: 'res://main.tscn',
            trace: { trace_id: 'deadbeef', span_id: 'cafe' },
        });
        client.disconnect();
        // Give the inbound handler a tick to log.
        await new Promise((r) => setTimeout(r, 20));

        const file = join(baseDir, '2026-08-01.jsonl');
        const raw = await readFile(file, 'utf8');
        const lines = raw
            .split('\n')
            .filter((l) => l !== '')
            .map((l) => JSON.parse(l) as Record<string, unknown>);
        const traced = lines.filter((l) => l.trace_id === 'deadbeef');
        expect(traced.length).toBeGreaterThanOrEqual(2);
        for (const line of traced) {
            expect(line.component).toBe('editor_ws_client');
        }
    });
});

