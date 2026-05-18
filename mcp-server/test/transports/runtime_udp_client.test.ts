/**
 * Tests for the RuntimeUdpClient — UDP transport that bridges the
 * MCP server to the running game's MCP runtime bridge.
 *
 * Coverage matches task 8.4.7:
 *   - happy path: connect + send + receive
 *   - port-scan: prefer the active-port file hint, otherwise scan
 *     6020-6029 via a UDP probe (empty `runtime.handshake` packet,
 *     500 ms timeout)
 *   - local PACKET_TOO_LARGE rejection (size gate runs before
 *     transmission, mirrors the GDScript-side rejection)
 *   - reconnect-by-handshake with the canonical exponential backoff
 *   - trace context round-trip: outgoing packets carry
 *     `trace.{trace_id, span_id}`; replies are correlated by id
 *   - heartbeat: `runtime.heartbeat` sent every `heartbeatIntervalMs`,
 *     timeout drops the connection and starts the reconnect loop
 *
 * The mock server is a plain `node:dgram` socket bound to an ephemeral
 * port so tests do not race the real 6020-6029 range.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as dgram from 'node:dgram';

import { AutoReconnect } from '../../src/auto_reconnect.js';
import { Metrics } from '../../src/metrics.js';
import { RuntimeUdpClient } from '../../src/transports/runtime_udp_client.js';
import {
    DEFAULT_MAX_PACKET_BYTES,
    PACKET_TOO_LARGE_CODE,
    PACKET_TOO_LARGE_MESSAGE,
} from '../../src/tools/runtime_bridge/packet_parser.js';

interface JsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
    id?: number;
    trace?: { trace_id?: string; span_id?: string };
}

interface MockUdpHandle {
    server: dgram.Socket;
    port: number;
    received: Array<{ req: JsonRpcRequest; rinfo: dgram.RemoteInfo }>;
    onMethod(
        method: string,
        responder: (req: JsonRpcRequest, rinfo: dgram.RemoteInfo) => void,
    ): void;
    /** Block all replies for a given method. */
    silenceMethod(method: string): void;
    /** Resume responding to a previously silenced method. */
    unsilenceMethod(method: string): void;
    close(): Promise<void>;
}

async function startMockUdpServer(
    options: { defaultHandshakeOk?: boolean } = {},
): Promise<MockUdpHandle> {
    const defaultHandshakeOk = options.defaultHandshakeOk ?? true;
    const server = dgram.createSocket('udp4');
    const responders = new Map<
        string,
        (req: JsonRpcRequest, rinfo: dgram.RemoteInfo) => void
    >();
    const silenced = new Set<string>();
    const received: Array<{ req: JsonRpcRequest; rinfo: dgram.RemoteInfo }> = [];

    server.on('message', (msg, rinfo) => {
        let parsed: JsonRpcRequest;
        try {
            parsed = JSON.parse(msg.toString('utf8')) as JsonRpcRequest;
        } catch {
            return;
        }
        received.push({ req: parsed, rinfo });
        if (silenced.has(parsed.method)) {
            return;
        }
        const responder = responders.get(parsed.method);
        if (responder !== undefined) {
            responder(parsed, rinfo);
            return;
        }
        // Default replies for protocol methods so probes / handshakes work
        // out of the box. Tests can override with `onMethod` when they
        // want to inspect or reject.
        if (parsed.method === 'runtime.handshake' && defaultHandshakeOk) {
            const reply = {
                jsonrpc: '2.0',
                id: parsed.id,
                result: {
                    authenticated: true,
                    server_version: '0.10.0',
                    latest_version: '0.10.0',
                },
            };
            server.send(Buffer.from(JSON.stringify(reply), 'utf8'), rinfo.port, rinfo.address);
            return;
        }
        if (parsed.method === 'runtime.heartbeat') {
            const reply = {
                jsonrpc: '2.0',
                id: parsed.id,
                result: { ok: true },
            };
            server.send(Buffer.from(JSON.stringify(reply), 'utf8'), rinfo.port, rinfo.address);
            return;
        }
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.bind(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            resolve();
        });
    });

    const port = server.address().port;

    function onMethod(
        method: string,
        responder: (req: JsonRpcRequest, rinfo: dgram.RemoteInfo) => void,
    ): void {
        responders.set(method, responder);
    }

    function silenceMethod(method: string): void {
        silenced.add(method);
    }

    function unsilenceMethod(method: string): void {
        silenced.delete(method);
    }

    function close(): Promise<void> {
        return new Promise((resolve) => {
            try {
                server.close(() => resolve());
            } catch {
                resolve();
            }
        });
    }

    return { server, port, received, onMethod, silenceMethod, unsilenceMethod, close };
}

describe('RuntimeUdpClient — happy path', () => {
    let server: MockUdpHandle;

    beforeEach(async () => {
        server = await startMockUdpServer();
        server.onMethod('test.echo', (req, rinfo) => {
            const reply = {
                jsonrpc: '2.0',
                id: req.id,
                result: { echoed: req.params },
            };
            server.server.send(
                Buffer.from(JSON.stringify(reply), 'utf8'),
                rinfo.port,
                rinfo.address,
            );
        });
    });

    afterEach(async () => {
        await server.close();
    });

    it('connects to a runtime port, sends a request and resolves with the result', async () => {
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await client.connect();
        expect(client.isConnected()).toBe(true);
        expect(client.targetPort).toBe(server.port);

        const result = await client.send('test.echo', { hello: 'world' });
        expect(result).toEqual({ echoed: { hello: 'world' } });

        client.disconnect();
        expect(client.isConnected()).toBe(false);
    });

    it('emits a connect event on successful handshake', async () => {
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        const onConnect = vi.fn();
        client.on('connect', onConnect);
        await client.connect();
        expect(onConnect).toHaveBeenCalledTimes(1);
        client.disconnect();
    });

    it('emits a disconnect event when disconnect() is called', async () => {
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });
        await client.connect();

        const onDisconnect = vi.fn();
        client.on('disconnect', onDisconnect);
        client.disconnect();
        await new Promise((r) => setTimeout(r, 20));
        expect(onDisconnect).toHaveBeenCalledTimes(1);
    });
});

describe('RuntimeUdpClient — port discovery', () => {
    let server: MockUdpHandle;
    let workdir: string;

    beforeEach(async () => {
        server = await startMockUdpServer();
        server.onMethod('test.ping', (req, rinfo) => {
            server.server.send(
                Buffer.from(
                    JSON.stringify({ jsonrpc: '2.0', id: req.id, result: 'pong' }),
                    'utf8',
                ),
                rinfo.port,
                rinfo.address,
            );
        });
        workdir = await mkdtemp(join(tmpdir(), 'runtime-udp-'));
    });

    afterEach(async () => {
        await server.close();
        await rm(workdir, { recursive: true, force: true });
    });

    it('uses the runtime port from mcp_active_port.json when the probe succeeds', async () => {
        const path = join(workdir, 'mcp_active_port.json');
        await writeFile(
            path,
            JSON.stringify({
                editor: 6010,
                runtime: server.port,
                visualizer: 6030,
                health: 6040,
            }),
            'utf8',
        );
        const metrics = new Metrics();
        const probedPorts: number[] = [];
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            // Wide range so the file hint is the cheapest path.
            range: { start: 1, end: 65535 },
            activePortFilePath: path,
            udpProbe: async (_host, port) => {
                probedPorts.push(port);
                return port === server.port;
            },
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await client.connect();
        expect(client.targetPort).toBe(server.port);
        expect(probedPorts[0]).toBe(server.port);
        const out = await client.send('test.ping', null);
        expect(out).toBe('pong');
        client.disconnect();
    });

    it('falls back to scanning the range when the active-port file is missing', async () => {
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            activePortFilePath: join(workdir, 'does-not-exist.json'),
            udpProbe: async (_host, port) => port === server.port,
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await client.connect();
        expect(client.targetPort).toBe(server.port);
        client.disconnect();
    });

    it('rejects connect() when no port in the range responds', async () => {
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: 6020, end: 6022 },
            udpProbe: async () => false,
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await expect(client.connect()).rejects.toThrowError(/no.*runtime.*port/i);
    });
});

describe('RuntimeUdpClient — packet-too-large rejection', () => {
    let server: MockUdpHandle;

    beforeEach(async () => {
        server = await startMockUdpServer();
    });

    afterEach(async () => {
        await server.close();
    });

    it('rejects locally when the encoded JSON-RPC payload exceeds maxPacketBytes', async () => {
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });
        await client.connect();

        // A payload larger than the IPv4 UDP ceiling (65507 bytes).
        const huge = 'x'.repeat(80_000);

        let caught: unknown;
        try {
            await client.send('test.huge', { blob: huge });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(Error);
        const err = caught as Error & { code?: number; data?: { size?: number; limit?: number } };
        expect(err.message).toContain(PACKET_TOO_LARGE_MESSAGE);
        expect(err.code).toBe(PACKET_TOO_LARGE_CODE);
        expect(err.data?.limit).toBe(DEFAULT_MAX_PACKET_BYTES);
        expect(typeof err.data?.size).toBe('number');
        expect(err.data?.size as number).toBeGreaterThan(DEFAULT_MAX_PACKET_BYTES);

        // Crucially, the server must NOT have observed the oversized packet.
        const sawHuge = server.received.some((r) => r.req.method === 'test.huge');
        expect(sawHuge).toBe(false);

        client.disconnect();
    });
});

describe('RuntimeUdpClient — handshake retry / auto-reconnect', () => {
    let server: MockUdpHandle;

    beforeEach(async () => {
        server = await startMockUdpServer();
    });

    afterEach(async () => {
        await server.close();
    });

    it('retransmits runtime.handshake with exponential backoff after a heartbeat timeout', async () => {
        const metrics = new Metrics();
        const ar = new AutoReconnect(metrics, [20, 40, 80]);
        // Server intentionally does not respond to heartbeats so the
        // client times out and starts the reconnect loop.
        server.silenceMethod('runtime.heartbeat');

        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            heartbeatIntervalMs: 30,
            heartbeatTimeoutMs: 60,
            enableAutoReconnect: true,
            autoReconnect: ar,
        });

        const onDisconnect = vi.fn();
        const onConnect = vi.fn();
        client.on('disconnect', onDisconnect);
        client.on('connect', onConnect);

        await client.connect();
        expect(onConnect).toHaveBeenCalledTimes(1);

        // Wait long enough for heartbeat timeout (~90 ms) plus the 20 ms
        // backoff slot. Re-handshake will succeed because the default
        // mock responder is still installed.
        await new Promise((r) => setTimeout(r, 250));

        expect(onDisconnect).toHaveBeenCalled();
        expect(metrics.get('mcp.reconnect.attempts')).toBeGreaterThanOrEqual(1);
        client.disconnect();
    });
});

describe('RuntimeUdpClient — trace context propagation', () => {
    let server: MockUdpHandle;

    beforeEach(async () => {
        server = await startMockUdpServer();
    });

    afterEach(async () => {
        await server.close();
    });

    it('attaches trace.{trace_id, span_id} to every outgoing packet', async () => {
        server.onMethod('test.echo', (req, rinfo) => {
            const reply = {
                jsonrpc: '2.0',
                id: req.id,
                result: { trace_in_request: req.trace },
            };
            server.server.send(
                Buffer.from(JSON.stringify(reply), 'utf8'),
                rinfo.port,
                rinfo.address,
            );
        });
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });
        await client.connect();

        const out = await client.send('test.echo', { i: 1 });
        const echoed = out as { trace_in_request: { trace_id: string; span_id: string } };

        expect(echoed.trace_in_request.trace_id).toMatch(/^[0-9a-f]{8}$/);
        expect(echoed.trace_in_request.span_id).toMatch(/^[0-9a-f]{4}$/);

        // Every observed packet (handshake + echo) must carry a trace
        // envelope of the same shape.
        for (const r of server.received) {
            expect(r.req.trace).toBeDefined();
            expect(r.req.trace?.trace_id).toMatch(/^[0-9a-f]{8}$/);
            expect(r.req.trace?.span_id).toMatch(/^[0-9a-f]{4}$/);
        }

        client.disconnect();
    });
});

describe('RuntimeUdpClient — heartbeat', () => {
    let server: MockUdpHandle;

    beforeEach(async () => {
        server = await startMockUdpServer();
    });

    afterEach(async () => {
        await server.close();
    });

    it('sends runtime.heartbeat every heartbeatIntervalMs while connected', async () => {
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            heartbeatIntervalMs: 50,
            heartbeatTimeoutMs: 1_000,
            enableAutoReconnect: false,
        });
        await client.connect();

        await new Promise((r) => setTimeout(r, 180));
        client.disconnect();

        const heartbeats = server.received.filter((r) => r.req.method === 'runtime.heartbeat');
        expect(heartbeats.length).toBeGreaterThanOrEqual(2);
        for (const hb of heartbeats) {
            expect(hb.req.jsonrpc).toBe('2.0');
            expect(typeof hb.req.id).toBe('number');
        }
    });
});

describe('RuntimeUdpClient — auth', () => {
    let server: MockUdpHandle;

    beforeEach(async () => {
        server = await startMockUdpServer({ defaultHandshakeOk: false });
    });

    afterEach(async () => {
        await server.close();
    });

    it('sends runtime.handshake with auth_token and accepts {authenticated: true}', async () => {
        let observedAuth: unknown;
        server.onMethod('runtime.handshake', (req, rinfo) => {
            observedAuth = (req.params as { auth_token?: string }).auth_token;
            const reply = {
                jsonrpc: '2.0',
                id: req.id,
                result: { authenticated: true, server_version: '0.10.0' },
            };
            server.server.send(
                Buffer.from(JSON.stringify(reply), 'utf8'),
                rinfo.port,
                rinfo.address,
            );
        });
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            authToken: 'secret-token',
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await client.connect();
        expect(observedAuth).toBe('secret-token');
        expect(client.isConnected()).toBe(true);
        client.disconnect();
    });

    it('rejects connect() when handshake responds {authenticated: false}', async () => {
        server.onMethod('runtime.handshake', (req, rinfo) => {
            const reply = {
                jsonrpc: '2.0',
                id: req.id,
                result: { authenticated: false },
            };
            server.server.send(
                Buffer.from(JSON.stringify(reply), 'utf8'),
                rinfo.port,
                rinfo.address,
            );
        });
        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            authToken: 'wrong-token',
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        const onError = vi.fn();
        client.on('error', onError);

        await expect(client.connect()).rejects.toThrowError(/authentic/i);
        expect(onError).toHaveBeenCalled();
        expect(client.isConnected()).toBe(false);
    });
});

describe('RuntimeUdpClient — request correlation under concurrent calls', () => {
    let server: MockUdpHandle;

    beforeEach(async () => {
        server = await startMockUdpServer();
    });

    afterEach(async () => {
        await server.close();
    });

    it('correlates concurrent requests by JSON-RPC id even when responses arrive out of order', async () => {
        const queued: Array<{ req: JsonRpcRequest; rinfo: dgram.RemoteInfo }> = [];
        const target = 5;
        const allArrived = new Promise<void>((resolve) => {
            server.onMethod('test.compute', (req, rinfo) => {
                queued.push({ req, rinfo });
                if (queued.length === target) resolve();
            });
        });

        const metrics = new Metrics();
        const client = new RuntimeUdpClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });
        await client.connect();

        const inFlight: Promise<unknown>[] = [];
        for (let i = 0; i < target; i++) {
            inFlight.push(client.send('test.compute', { i }));
        }

        await allArrived;
        // Reply in reverse arrival order to prove correlation works.
        for (const { req, rinfo } of [...queued].reverse()) {
            server.server.send(
                Buffer.from(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: req.id,
                        result: {
                            input: req.params,
                            doubled: (req.params as { i: number }).i * 2,
                        },
                    }),
                    'utf8',
                ),
                rinfo.port,
                rinfo.address,
            );
        }

        const results = await Promise.all(inFlight);
        for (let i = 0; i < target; i++) {
            expect(results[i]).toEqual({ input: { i }, doubled: i * 2 });
        }
        client.disconnect();
    });
});
