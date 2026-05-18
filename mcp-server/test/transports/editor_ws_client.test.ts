/**
 * Tests for the EditorWsClient — WebSocket transport that bridges the
 * MCP server to the Godot editor plugin.
 *
 * Coverage matches task 8.3.7:
 *   - happy path: connect + send + receive
 *   - port-scan: first listening port in 6010-6019 wins, with the
 *     `mcp_active_port.json` hint preferred when valid
 *   - auto-reconnect with exponential backoff bounds
 *   - heartbeat sends every `heartbeatIntervalMs`
 *   - heartbeat timeout drops the connection and reconnects
 *   - auth success / failure via the initial `runtime.handshake`
 *   - request↔response correlation under concurrent calls
 *
 * The mock WebSocket server is a plain `ws.WebSocketServer` started in
 * the same process and bound to an ephemeral port. Tests inject a
 * narrow `range` and `activePortFilePath` so they can drive the
 * port-discovery logic without touching the real 6010-6019 range.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket as ServerSideSocket } from 'ws';

import { AutoReconnect } from '../../src/auto_reconnect.js';
import { Metrics } from '../../src/metrics.js';
import { EditorWsClient } from '../../src/transports/editor_ws_client.js';

interface JsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
    id: number;
}

interface MockServerHandle {
    server: WebSocketServer;
    port: number;
    sockets: Set<ServerSideSocket>;
    received: JsonRpcRequest[];
    /** Resolves the next request that arrives. */
    waitForRequest(method: string, timeoutMs?: number): Promise<JsonRpcRequest>;
    /** Override the responder for a specific method. */
    onMethod(
        method: string,
        responder: (req: JsonRpcRequest, ws: ServerSideSocket) => void,
    ): void;
    closeAllSockets(): void;
    close(): Promise<void>;
}

async function startMockServer(): Promise<MockServerHandle> {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    if (typeof address === 'string' || address === null) {
        throw new Error('Mock server did not bind to a TCP port.');
    }
    const port = address.port;
    const sockets = new Set<ServerSideSocket>();
    const received: JsonRpcRequest[] = [];
    const responders = new Map<
        string,
        (req: JsonRpcRequest, ws: ServerSideSocket) => void
    >();
    const waiters = new Map<
        string,
        ((req: JsonRpcRequest) => void)[]
    >();

    server.on('connection', (ws) => {
        sockets.add(ws);
        ws.on('close', () => sockets.delete(ws));
        ws.on('message', (raw) => {
            const text = typeof raw === 'string' ? raw : raw.toString('utf8');
            let parsed: JsonRpcRequest;
            try {
                parsed = JSON.parse(text) as JsonRpcRequest;
            } catch {
                return;
            }
            received.push(parsed);
            const queued = waiters.get(parsed.method);
            if (queued && queued.length > 0) {
                const resolver = queued.shift()!;
                resolver(parsed);
            }
            const responder = responders.get(parsed.method);
            if (responder) {
                responder(parsed, ws);
            }
        });
    });

    function waitForRequest(method: string, timeoutMs = 1_000): Promise<JsonRpcRequest> {
        const existing = received.find((r) => r.method === method);
        if (existing !== undefined) {
            return Promise.resolve(existing);
        }
        return new Promise<JsonRpcRequest>((resolve, reject) => {
            const list = waiters.get(method) ?? [];
            list.push(resolve);
            waiters.set(method, list);
            setTimeout(() => {
                const queued = waiters.get(method);
                if (queued) {
                    const idx = queued.indexOf(resolve);
                    if (idx >= 0) {
                        queued.splice(idx, 1);
                    }
                }
                reject(new Error(`Timed out waiting for ${method} after ${timeoutMs}ms.`));
            }, timeoutMs).unref?.();
        });
    }

    function onMethod(
        method: string,
        responder: (req: JsonRpcRequest, ws: ServerSideSocket) => void,
    ): void {
        responders.set(method, responder);
    }

    function closeAllSockets(): void {
        for (const ws of [...sockets]) {
            ws.close();
        }
    }

    function close(): Promise<void> {
        return new Promise((resolve) => {
            for (const ws of [...sockets]) {
                ws.terminate();
            }
            sockets.clear();
            server.close(() => resolve());
        });
    }

    return {
        server,
        port,
        sockets,
        received,
        waitForRequest,
        onMethod,
        closeAllSockets,
        close,
    };
}

/** Default echo responder: every incoming method gets a `result: <method>:<id>`. */
function installEchoResponders(handle: MockServerHandle): void {
    handle.server.on('connection', (ws) => {
        ws.on('message', (raw) => {
            const text = typeof raw === 'string' ? raw : raw.toString('utf8');
            let parsed: JsonRpcRequest;
            try {
                parsed = JSON.parse(text) as JsonRpcRequest;
            } catch {
                return;
            }
            // The named overrides registered through `onMethod` win over
            // this global echo. We only emit a default reply when no
            // override has been registered.
            // Easier: just always echo if nobody else replies.
            const reply = {
                jsonrpc: '2.0',
                id: parsed.id,
                result: { method: parsed.method, id: parsed.id },
            };
            // Schedule asynchronously so explicit responders attached via
            // `onMethod` get a chance to reply first when they want to.
            queueMicrotask(() => {
                if (ws.readyState === ws.OPEN) {
                    try {
                        ws.send(JSON.stringify(reply));
                    } catch {
                        // ignore
                    }
                }
            });
        });
    });
}

describe('EditorWsClient — happy path', () => {
    let server: MockServerHandle;

    beforeEach(async () => {
        server = await startMockServer();
        server.onMethod('test.echo', (req, ws) => {
            ws.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: req.id,
                    result: { echoed: req.params },
                }),
            );
        });
    });

    afterEach(async () => {
        await server.close();
    });

    it('connects to the editor port, sends a request and resolves with the result', async () => {
        const metrics = new Metrics();
        const client = new EditorWsClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await client.connect();
        expect(client.isConnected()).toBe(true);

        const result = await client.send('test.echo', { hello: 'world' });
        expect(result).toEqual({ echoed: { hello: 'world' } });

        client.disconnect();
        expect(client.isConnected()).toBe(false);
    });

    it('emits a connect event on successful open', async () => {
        const metrics = new Metrics();
        const client = new EditorWsClient({
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

    it('emits a disconnect event when the client tears down the socket', async () => {
        const metrics = new Metrics();
        const client = new EditorWsClient({
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

describe('EditorWsClient — port discovery', () => {
    let server: MockServerHandle;
    let workdir: string;

    beforeEach(async () => {
        server = await startMockServer();
        server.onMethod('test.echo', (req, ws) => {
            ws.send(
                JSON.stringify({ jsonrpc: '2.0', id: req.id, result: 'ok' }),
            );
        });
        workdir = await mkdtemp(join(tmpdir(), 'editor-ws-'));
    });

    afterEach(async () => {
        await server.close();
        await rm(workdir, { recursive: true, force: true });
    });

    it('uses the editor port from mcp_active_port.json when the port is listening', async () => {
        const path = join(workdir, 'mcp_active_port.json');
        await writeFile(
            path,
            JSON.stringify({
                editor: server.port,
                runtime: 6020,
                visualizer: 6030,
                health: 6040,
            }),
            'utf8',
        );
        const metrics = new Metrics();
        const client = new EditorWsClient({
            metrics,
            host: '127.0.0.1',
            // A very wide range so the file hint is the cheapest path.
            range: { start: 1, end: 65535 },
            activePortFilePath: path,
            tcpProbe: async (_host, port) => port === server.port,
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await client.connect();
        expect(client.targetPort).toBe(server.port);
        const out = await client.send('test.echo', null);
        expect(out).toBe('ok');
        client.disconnect();
    });

    it('falls back to scanning the range when the active-port file is missing', async () => {
        const metrics = new Metrics();
        const client = new EditorWsClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            activePortFilePath: join(workdir, 'does-not-exist.json'),
            tcpProbe: async (_host, port) => port === server.port,
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await client.connect();
        expect(client.targetPort).toBe(server.port);
        client.disconnect();
    });

    it('returns the first listening port when the file hint points to a closed port', async () => {
        const path = join(workdir, 'mcp_active_port.json');
        // The file declares a port that the probe reports as closed.
        await writeFile(
            path,
            JSON.stringify({
                editor: 1,
                runtime: 6020,
                visualizer: 6030,
                health: 6040,
            }),
            'utf8',
        );
        const metrics = new Metrics();
        const probedPorts: number[] = [];
        const client = new EditorWsClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port - 1, end: server.port + 1 },
            activePortFilePath: path,
            tcpProbe: async (_host, port) => {
                probedPorts.push(port);
                return port === server.port;
            },
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await client.connect();
        expect(client.targetPort).toBe(server.port);
        // The hinted port (1) was probed first, then the range was scanned
        // until a listening port was found.
        expect(probedPorts[0]).toBe(1);
        expect(probedPorts).toContain(server.port);
        client.disconnect();
    });

    it('rejects connect() when no port in the range is listening', async () => {
        const metrics = new Metrics();
        const client = new EditorWsClient({
            metrics,
            host: '127.0.0.1',
            range: { start: 6010, end: 6012 },
            tcpProbe: async () => false,
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await expect(client.connect()).rejects.toThrowError(/no listening editor port/i);
    });
});

describe('EditorWsClient — heartbeat', () => {
    let server: MockServerHandle;

    beforeEach(async () => {
        server = await startMockServer();
    });

    afterEach(async () => {
        await server.close();
    });

    it('sends runtime.heartbeat every heartbeatIntervalMs while connected', async () => {
        const heartbeats: JsonRpcRequest[] = [];
        server.onMethod('runtime.heartbeat', (req, ws) => {
            heartbeats.push(req);
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }));
        });
        const metrics = new Metrics();
        const client = new EditorWsClient({
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

        expect(heartbeats.length).toBeGreaterThanOrEqual(2);
        for (const hb of heartbeats) {
            expect(hb.method).toBe('runtime.heartbeat');
            expect(hb.jsonrpc).toBe('2.0');
            expect(typeof hb.id).toBe('number');
        }
    });

    it('disconnects and reconnects when no heartbeat reply arrives within heartbeatTimeoutMs', async () => {
        // Server intentionally does not respond to heartbeats.
        const metrics = new Metrics();
        const ar = new AutoReconnect(metrics, [20, 40, 80]);
        const client = new EditorWsClient({
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

        // Wait long enough for heartbeat to fire and time out, plus the
        // 20ms backoff for the reconnect.
        await new Promise((r) => setTimeout(r, 250));

        expect(onDisconnect).toHaveBeenCalled();
        expect(metrics.get('mcp.reconnect.attempts')).toBeGreaterThanOrEqual(1);
        client.disconnect();
    });
});

describe('EditorWsClient — auto-reconnect with exponential backoff', () => {
    let server: MockServerHandle;

    beforeEach(async () => {
        server = await startMockServer();
        server.onMethod('test.echo', (req, ws) => {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: 'ok' }));
        });
    });

    afterEach(async () => {
        await server.close();
    });

    it('schedules reconnect attempts with the AutoReconnect schedule and resets on success', async () => {
        const metrics = new Metrics();
        const ar = new AutoReconnect(metrics, [20, 40, 80]);
        const nextBackoffSpy = vi.spyOn(ar, 'nextBackoffMs');
        const onConnectedSpy = vi.spyOn(ar, 'onConnected');

        const client = new EditorWsClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: true,
            autoReconnect: ar,
        });

        const onConnect = vi.fn();
        const onDisconnect = vi.fn();
        client.on('connect', onConnect);
        client.on('disconnect', onDisconnect);

        await client.connect();
        expect(onConnectedSpy).toHaveBeenCalledTimes(1); // initial connect resets schedule

        // Force the server to drop the existing socket. The client should
        // detect the disconnect and start the backoff schedule.
        server.closeAllSockets();
        // First reconnect uses 20ms (first entry in the custom schedule).
        await new Promise((r) => setTimeout(r, 250));

        expect(onDisconnect).toHaveBeenCalled();
        expect(nextBackoffSpy).toHaveBeenCalled();
        // After at least one reconnect attempt the metrics must be updated.
        expect(metrics.get('mcp.reconnect.attempts')).toBeGreaterThanOrEqual(1);
        // Successful reconnect resets the schedule so onConnected is called
        // a second time.
        expect(onConnectedSpy).toHaveBeenCalledTimes(2);
        // After the reset the gauge stays at the latest scheduled delay
        // (20ms) — onConnected does not touch metrics.
        expect(client.isConnected()).toBe(true);

        client.disconnect();
    });

    it('keeps walking the schedule when reconnect attempts fail', async () => {
        const metrics = new Metrics();
        const ar = new AutoReconnect(metrics, [20, 40, 80]);
        const probedPorts: number[] = [];
        let allowConnect = true;
        const client = new EditorWsClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            tcpProbe: async (_host, port) => {
                probedPorts.push(port);
                return allowConnect && port === server.port;
            },
            enableHeartbeat: false,
            enableAutoReconnect: true,
            autoReconnect: ar,
        });
        await client.connect();
        expect(client.isConnected()).toBe(true);

        // Pretend the editor is gone: probe always returns false and the
        // server stops accepting new sockets after we close it below.
        allowConnect = false;
        await server.close();
        server.closeAllSockets();

        // Allow several backoff intervals to elapse so we can see the
        // schedule advance. 20 + 40 + 80 = 140ms; add slack.
        await new Promise((r) => setTimeout(r, 350));

        expect(metrics.get('mcp.reconnect.attempts')).toBeGreaterThanOrEqual(2);
        // The backoff gauge must reach at least 40ms — the second entry —
        // proving the schedule advanced past the first slot.
        expect(metrics.get('mcp.reconnect.backoff_ms')).toBeGreaterThanOrEqual(40);

        client.disconnect();
    });
});

describe('EditorWsClient — auth', () => {
    let server: MockServerHandle;

    beforeEach(async () => {
        server = await startMockServer();
    });

    afterEach(async () => {
        await server.close();
    });

    it('sends runtime.handshake on connect and accepts {authenticated: true}', async () => {
        let handshakeParams: unknown;
        server.onMethod('runtime.handshake', (req, ws) => {
            handshakeParams = req.params;
            ws.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: req.id,
                    result: {
                        authenticated: true,
                        server_version: '0.10.0',
                        latest_version: '0.10.0',
                    },
                }),
            );
        });
        server.onMethod('test.echo', (req, ws) => {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: 'pong' }));
        });

        const metrics = new Metrics();
        const client = new EditorWsClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            authToken: 'secret-token',
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await client.connect();
        expect(client.isConnected()).toBe(true);
        expect(handshakeParams).toEqual({ auth_token: 'secret-token' });

        const out = await client.send('test.echo', null);
        expect(out).toBe('pong');
        client.disconnect();
    });

    it('emits an error and disconnects when handshake responds {authenticated: false}', async () => {
        server.onMethod('runtime.handshake', (req, ws) => {
            ws.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: req.id,
                    result: { authenticated: false },
                }),
            );
        });
        const metrics = new Metrics();
        const client = new EditorWsClient({
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

    it('emits an error and disconnects when handshake returns a JSON-RPC error', async () => {
        server.onMethod('runtime.handshake', (req, ws) => {
            ws.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: req.id,
                    error: { code: -32008, message: 'AUTH_FAILED' },
                }),
            );
        });
        const metrics = new Metrics();
        const client = new EditorWsClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            authToken: 'wrong-token',
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        const onError = vi.fn();
        client.on('error', onError);

        await expect(client.connect()).rejects.toThrowError(/AUTH_FAILED|authentic/i);
        expect(onError).toHaveBeenCalled();
        expect(client.isConnected()).toBe(false);
    });
});

describe('EditorWsClient — request correlation under concurrent calls', () => {
    let server: MockServerHandle;

    beforeEach(async () => {
        server = await startMockServer();
    });

    afterEach(async () => {
        await server.close();
    });

    it('correlates 5 concurrent requests by JSON-RPC id even when responses arrive out of order', async () => {
        // Stash incoming requests, then reply in a shuffled order.
        const queued: { req: JsonRpcRequest; ws: ServerSideSocket }[] = [];
        const target = 5;
        const allArrived = new Promise<void>((resolve) => {
            server.onMethod('test.compute', (req, ws) => {
                queued.push({ req, ws });
                if (queued.length === target) resolve();
            });
        });

        const metrics = new Metrics();
        const client = new EditorWsClient({
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
        for (const { req, ws } of [...queued].reverse()) {
            ws.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: req.id,
                    result: { input: req.params, doubled: (req.params as { i: number }).i * 2 },
                }),
            );
        }

        const results = await Promise.all(inFlight);
        for (let i = 0; i < target; i++) {
            expect(results[i]).toEqual({ input: { i }, doubled: i * 2 });
        }
        client.disconnect();
    });

    it('rejects pending requests with a disconnect error when the socket closes mid-flight', async () => {
        // Server collects requests and then drops the connection without replying.
        let received = 0;
        server.onMethod('test.slow', (_req, _ws) => {
            received += 1;
            if (received === 2) {
                server.closeAllSockets();
            }
        });
        const metrics = new Metrics();
        const client = new EditorWsClient({
            metrics,
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });
        await client.connect();

        const a = client.send('test.slow', { i: 0 });
        const b = client.send('test.slow', { i: 1 });
        await Promise.all([
            expect(a).rejects.toThrowError(/disconnect|closed/i),
            expect(b).rejects.toThrowError(/disconnect|closed/i),
        ]);
        expect(client.isConnected()).toBe(false);
    });
});
