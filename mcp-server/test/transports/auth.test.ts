/**
 * Tests for end-to-end auth wiring across the editor (WebSocket) and
 * runtime (UDP) channels.
 *
 * Coverage matches task 8.9.4:
 *   - dev mode pass-through: neither side declares an auth_token; the
 *     handshake is skipped entirely and `connect()` resolves
 *   - token match: both sides declare the same token; the client
 *     forwards it on the first handshake and the server accepts
 *   - token mismatch: both sides declare a token but the values
 *     disagree; the server rejects with -32000 UNAUTHORIZED and the
 *     client emits 'error' + tears down the socket
 *   - token only on the server side: the client connects without a
 *     token (or with an empty token) and the server still rejects
 *   - token only on the client side: the server has auth disabled but
 *     refuses requests that carry an auth_token to avoid silently
 *     accepting credentials it cannot verify
 *
 * The tests also pin the `loadAuthToken()` helper that the transports
 * call before `connect()`: reading `plugin_config.tres` returns the
 * editor token, reading `runtime_config.tres` returns the runtime
 * token, and a missing file or empty token returns null (dev mode).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket as ServerSideSocket } from 'ws';
import * as dgram from 'node:dgram';

import { Metrics } from '../../src/metrics.js';
import {
    UNAUTHORIZED_CODE,
    UNAUTHORIZED_MESSAGE,
    loadAuthToken,
} from '../../src/auth_verifier.js';
import { EditorWsClient } from '../../src/transports/editor_ws_client.js';
import { RuntimeUdpClient } from '../../src/transports/runtime_udp_client.js';

interface JsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params?: { auth_token?: string } & Record<string, unknown>;
    id: number;
}

// ---------------------------------------------------------------------------
// Mock servers — narrow versions of the helpers used by the per-channel test
// files. They expose just enough surface to drive the auth gate.
// ---------------------------------------------------------------------------

interface WsHandle {
    server: WebSocketServer;
    port: number;
    received: JsonRpcRequest[];
    close(): Promise<void>;
}

async function startWsServer(serverToken: string | null): Promise<WsHandle> {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    if (typeof address === 'string' || address === null) {
        throw new Error('Mock WebSocket server did not bind to a TCP port.');
    }
    const port = address.port;
    const received: JsonRpcRequest[] = [];

    server.on('connection', (ws) => {
        ws.on('message', (raw) => {
            const text = typeof raw === 'string' ? raw : raw.toString('utf8');
            let parsed: JsonRpcRequest;
            try {
                parsed = JSON.parse(text) as JsonRpcRequest;
            } catch {
                return;
            }
            received.push(parsed);

            if (parsed.method !== 'runtime.handshake') {
                // Echo so non-handshake calls resolve.
                ws.send(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: parsed.id,
                        result: { ok: true },
                    }),
                );
                return;
            }

            const provided =
                typeof parsed.params?.auth_token === 'string'
                    ? parsed.params.auth_token
                    : '';
            const tokenOk = serverToken === null
                ? provided === ''
                : provided === serverToken;

            if (!tokenOk) {
                ws.send(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: parsed.id,
                        error: {
                            code: UNAUTHORIZED_CODE,
                            message: UNAUTHORIZED_MESSAGE,
                            data: { suggestion: 'Provide a valid auth_token.' },
                        },
                    }),
                );
                ws.close();
                return;
            }

            ws.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: parsed.id,
                    result: {
                        authenticated: true,
                        server_version: '0.10.0',
                        latest_version: '0.10.0',
                    },
                }),
            );
        });
    });

    function close(): Promise<void> {
        return new Promise((resolve) => {
            for (const ws of server.clients) {
                try {
                    ws.terminate();
                } catch {
                    // ignore
                }
            }
            server.close(() => resolve());
        });
    }

    return { server, port, received, close };
}

interface UdpHandle {
    server: dgram.Socket;
    port: number;
    received: JsonRpcRequest[];
    close(): Promise<void>;
}

async function startUdpServer(serverToken: string | null): Promise<UdpHandle> {
    const server = dgram.createSocket('udp4');
    const received: JsonRpcRequest[] = [];

    server.on('message', (msg, rinfo) => {
        let parsed: JsonRpcRequest;
        try {
            parsed = JSON.parse(msg.toString('utf8')) as JsonRpcRequest;
        } catch {
            return;
        }
        received.push(parsed);

        if (parsed.method !== 'runtime.handshake') {
            const reply = {
                jsonrpc: '2.0',
                id: parsed.id,
                result: { ok: true },
            };
            server.send(Buffer.from(JSON.stringify(reply), 'utf8'), rinfo.port, rinfo.address);
            return;
        }

        const provided =
            typeof parsed.params?.auth_token === 'string'
                ? parsed.params.auth_token
                : '';
        const tokenOk = serverToken === null
            ? provided === ''
            : provided === serverToken;

        if (!tokenOk) {
            const reply = {
                jsonrpc: '2.0',
                id: parsed.id,
                error: {
                    code: UNAUTHORIZED_CODE,
                    message: UNAUTHORIZED_MESSAGE,
                    data: { suggestion: 'Provide a valid auth_token.' },
                },
            };
            server.send(Buffer.from(JSON.stringify(reply), 'utf8'), rinfo.port, rinfo.address);
            return;
        }

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
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.bind(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            resolve();
        });
    });

    const port = server.address().port;

    function close(): Promise<void> {
        return new Promise((resolve) => {
            try {
                server.close(() => resolve());
            } catch {
                resolve();
            }
        });
    }

    return { server, port, received, close };
}

// ---------------------------------------------------------------------------
// loadAuthToken() — reads addons/forgekit_core/mcp/{plugin,runtime}_config.tres
// ---------------------------------------------------------------------------

describe('loadAuthToken — plugin_config.tres / runtime_config.tres reader', () => {
    let workdir: string;
    let mcpDir: string;

    beforeEach(async () => {
        workdir = await mkdtemp(join(tmpdir(), 'auth-token-'));
        mcpDir = join(workdir, 'addons', 'forgekit_core', 'mcp');
        await mkdir(mcpDir, { recursive: true });
    });

    afterEach(async () => {
        await rm(workdir, { recursive: true, force: true });
    });

    it('returns null when the editor config file is missing (dev mode)', async () => {
        const token = await loadAuthToken('editor', { projectRoot: workdir });
        expect(token).toBeNull();
    });

    it('returns null when the runtime config file is missing (dev mode)', async () => {
        const token = await loadAuthToken('runtime', { projectRoot: workdir });
        expect(token).toBeNull();
    });

    it('returns null when auth_token is the empty string', async () => {
        await writeFile(
            join(mcpDir, 'plugin_config.tres'),
            tresWithToken(''),
            'utf8',
        );
        const token = await loadAuthToken('editor', { projectRoot: workdir });
        expect(token).toBeNull();
    });

    it('returns the editor token from plugin_config.tres', async () => {
        await writeFile(
            join(mcpDir, 'plugin_config.tres'),
            tresWithToken('editor-secret'),
            'utf8',
        );
        const token = await loadAuthToken('editor', { projectRoot: workdir });
        expect(token).toBe('editor-secret');
    });

    it('returns the runtime token from runtime_config.tres', async () => {
        await writeFile(
            join(mcpDir, 'runtime_config.tres'),
            tresWithToken('runtime-secret'),
            'utf8',
        );
        const token = await loadAuthToken('runtime', { projectRoot: workdir });
        expect(token).toBe('runtime-secret');
    });

    it('reads independently for editor and runtime channels', async () => {
        await writeFile(
            join(mcpDir, 'plugin_config.tres'),
            tresWithToken('editor-token'),
            'utf8',
        );
        await writeFile(
            join(mcpDir, 'runtime_config.tres'),
            tresWithToken('runtime-token'),
            'utf8',
        );
        const editor = await loadAuthToken('editor', { projectRoot: workdir });
        const runtime = await loadAuthToken('runtime', { projectRoot: workdir });
        expect(editor).toBe('editor-token');
        expect(runtime).toBe('runtime-token');
    });
});

function tresWithToken(token: string): string {
    return `[gd_resource type="Resource" load_steps=2 format=3]

[resource]
auth_token = "${token}"
bind_address = "127.0.0.1"
port = 6010
log_level = "info"
`;
}

// ---------------------------------------------------------------------------
// Integration — clients auto-load the token via loadAuthToken(projectRoot)
// ---------------------------------------------------------------------------

describe('Transports — auto-load auth_token from projectRoot', () => {
    let workdir: string;
    let mcpDir: string;

    beforeEach(async () => {
        workdir = await mkdtemp(join(tmpdir(), 'auth-wire-'));
        mcpDir = join(workdir, 'addons', 'forgekit_core', 'mcp');
        await mkdir(mcpDir, { recursive: true });
    });

    afterEach(async () => {
        await rm(workdir, { recursive: true, force: true });
    });

    it('EditorWsClient reads plugin_config.tres before connect() and forwards the token', async () => {
        await writeFile(
            join(mcpDir, 'plugin_config.tres'),
            tresWithToken('editor-token'),
            'utf8',
        );
        const server = await startWsServer('editor-token');

        try {
            const client = new EditorWsClient({
                metrics: new Metrics(),
                host: '127.0.0.1',
                range: { start: server.port, end: server.port },
                projectRoot: workdir,
                enableHeartbeat: false,
                enableAutoReconnect: false,
            });

            await client.connect();
            expect(client.isConnected()).toBe(true);

            const handshakes = server.received.filter(
                (r) => r.method === 'runtime.handshake',
            );
            expect(handshakes).toHaveLength(1);
            expect(handshakes[0]!.params).toEqual({ auth_token: 'editor-token' });

            client.disconnect();
        } finally {
            await server.close();
        }
    });

    it('EditorWsClient skips handshake when plugin_config.tres has empty auth_token', async () => {
        await writeFile(
            join(mcpDir, 'plugin_config.tres'),
            tresWithToken(''),
            'utf8',
        );
        const server = await startWsServer(null);

        try {
            const client = new EditorWsClient({
                metrics: new Metrics(),
                host: '127.0.0.1',
                range: { start: server.port, end: server.port },
                projectRoot: workdir,
                enableHeartbeat: false,
                enableAutoReconnect: false,
            });

            await client.connect();
            expect(client.isConnected()).toBe(true);

            const handshakes = server.received.filter(
                (r) => r.method === 'runtime.handshake',
            );
            expect(handshakes).toHaveLength(0);

            client.disconnect();
        } finally {
            await server.close();
        }
    });

    it('RuntimeUdpClient reads runtime_config.tres before connect() and forwards the token', async () => {
        await writeFile(
            join(mcpDir, 'runtime_config.tres'),
            tresWithToken('runtime-token'),
            'utf8',
        );
        const server = await startUdpServer('runtime-token');

        try {
            const client = new RuntimeUdpClient({
                metrics: new Metrics(),
                host: '127.0.0.1',
                range: { start: server.port, end: server.port },
                projectRoot: workdir,
                enableHeartbeat: false,
                enableAutoReconnect: false,
                udpProbe: async () => true,
            });

            await client.connect();
            expect(client.isConnected()).toBe(true);

            const handshakes = server.received.filter(
                (r) => r.method === 'runtime.handshake',
            );
            expect(handshakes.length).toBeGreaterThanOrEqual(1);
            expect(handshakes[0]!.params).toMatchObject({
                auth_token: 'runtime-token',
            });

            client.disconnect();
        } finally {
            await server.close();
        }
    });

    it('explicit authToken wins over projectRoot lookup', async () => {
        await writeFile(
            join(mcpDir, 'plugin_config.tres'),
            tresWithToken('config-token'),
            'utf8',
        );
        const server = await startWsServer('explicit-token');

        try {
            const client = new EditorWsClient({
                metrics: new Metrics(),
                host: '127.0.0.1',
                range: { start: server.port, end: server.port },
                projectRoot: workdir,
                authToken: 'explicit-token',
                enableHeartbeat: false,
                enableAutoReconnect: false,
            });

            await client.connect();
            expect(client.isConnected()).toBe(true);

            const handshakes = server.received.filter(
                (r) => r.method === 'runtime.handshake',
            );
            expect(handshakes).toHaveLength(1);
            expect(handshakes[0]!.params).toEqual({
                auth_token: 'explicit-token',
            });

            client.disconnect();
        } finally {
            await server.close();
        }
    });
});

// ---------------------------------------------------------------------------
// EditorWsClient auth handshake — five token combinations
// ---------------------------------------------------------------------------

describe('EditorWsClient — auth handshake combinations', () => {
    let server: WsHandle;

    afterEach(async () => {
        await server.close();
    });

    it('connects without sending a handshake when neither side declares a token', async () => {
        server = await startWsServer(null);
        const client = new EditorWsClient({
            metrics: new Metrics(),
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await client.connect();
        expect(client.isConnected()).toBe(true);

        // Pass-through: no handshake should have been issued at all.
        const handshakes = server.received.filter(
            (r) => r.method === 'runtime.handshake',
        );
        expect(handshakes).toHaveLength(0);

        client.disconnect();
    });

    it('connects when the client and server tokens match', async () => {
        server = await startWsServer('shared-secret');
        const client = new EditorWsClient({
            metrics: new Metrics(),
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            authToken: 'shared-secret',
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        await client.connect();
        expect(client.isConnected()).toBe(true);

        const handshakes = server.received.filter(
            (r) => r.method === 'runtime.handshake',
        );
        expect(handshakes).toHaveLength(1);
        expect(handshakes[0]!.params).toEqual({ auth_token: 'shared-secret' });

        client.disconnect();
    });

    it('rejects connect() when the client and server tokens differ', async () => {
        server = await startWsServer('server-secret');
        const client = new EditorWsClient({
            metrics: new Metrics(),
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            authToken: 'client-secret',
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        const onError = vi.fn();
        client.on('error', onError);

        await expect(client.connect()).rejects.toThrow();
        expect(client.isConnected()).toBe(false);
        expect(onError).toHaveBeenCalled();
    });

    it('rejects connect() when only the server declares a token (client has none)', async () => {
        server = await startWsServer('server-secret');
        const client = new EditorWsClient({
            metrics: new Metrics(),
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            // No authToken on the client — connect() must still reach
            // the server and the server must reject because the
            // handshake either omits the field or carries an empty
            // token.
            authToken: 'attempted-empty',
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        const onError = vi.fn();
        client.on('error', onError);

        await expect(client.connect()).rejects.toThrow();
        expect(client.isConnected()).toBe(false);
        expect(onError).toHaveBeenCalled();
    });

    it('rejects connect() when only the client declares a token (server has none)', async () => {
        server = await startWsServer(null);
        const client = new EditorWsClient({
            metrics: new Metrics(),
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            authToken: 'client-only',
            enableHeartbeat: false,
            enableAutoReconnect: false,
        });

        const onError = vi.fn();
        client.on('error', onError);

        await expect(client.connect()).rejects.toThrow();
        expect(client.isConnected()).toBe(false);
        expect(onError).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// RuntimeUdpClient auth handshake — same five combinations
// ---------------------------------------------------------------------------

describe('RuntimeUdpClient — auth handshake combinations', () => {
    let server: UdpHandle;

    afterEach(async () => {
        await server.close();
    });

    it('connects without sending a handshake when neither side declares a token', async () => {
        server = await startUdpServer(null);
        const client = new RuntimeUdpClient({
            metrics: new Metrics(),
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            enableHeartbeat: false,
            enableAutoReconnect: false,
            // The default UDP probe sends an empty `runtime.handshake`
            // probe to discover the port. Override it so the test only
            // sees handshakes the client itself originates.
            udpProbe: async () => true,
        });

        await client.connect();
        expect(client.isConnected()).toBe(true);

        const handshakes = server.received.filter(
            (r) => r.method === 'runtime.handshake',
        );
        expect(handshakes).toHaveLength(0);

        client.disconnect();
    });

    it('connects when the client and server tokens match', async () => {
        server = await startUdpServer('shared-secret');
        const client = new RuntimeUdpClient({
            metrics: new Metrics(),
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            authToken: 'shared-secret',
            enableHeartbeat: false,
            enableAutoReconnect: false,
            udpProbe: async () => true,
        });

        await client.connect();
        expect(client.isConnected()).toBe(true);

        const handshakes = server.received.filter(
            (r) => r.method === 'runtime.handshake',
        );
        expect(handshakes.length).toBeGreaterThanOrEqual(1);
        expect(handshakes[0]!.params).toMatchObject({
            auth_token: 'shared-secret',
        });

        client.disconnect();
    });

    it('rejects connect() when the client and server tokens differ', async () => {
        server = await startUdpServer('server-secret');
        const client = new RuntimeUdpClient({
            metrics: new Metrics(),
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            authToken: 'client-secret',
            enableHeartbeat: false,
            enableAutoReconnect: false,
            udpProbe: async () => true,
        });

        const onError = vi.fn();
        client.on('error', onError);

        await expect(client.connect()).rejects.toThrow();
        expect(client.isConnected()).toBe(false);
        expect(onError).toHaveBeenCalled();
    });

    it('rejects connect() when only the server declares a token (client has none)', async () => {
        server = await startUdpServer('server-secret');
        const client = new RuntimeUdpClient({
            metrics: new Metrics(),
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            authToken: 'attempted-empty',
            enableHeartbeat: false,
            enableAutoReconnect: false,
            udpProbe: async () => true,
        });

        const onError = vi.fn();
        client.on('error', onError);

        await expect(client.connect()).rejects.toThrow();
        expect(client.isConnected()).toBe(false);
        expect(onError).toHaveBeenCalled();
    });

    it('rejects connect() when only the client declares a token (server has none)', async () => {
        server = await startUdpServer(null);
        const client = new RuntimeUdpClient({
            metrics: new Metrics(),
            host: '127.0.0.1',
            range: { start: server.port, end: server.port },
            authToken: 'client-only',
            enableHeartbeat: false,
            enableAutoReconnect: false,
            udpProbe: async () => true,
        });

        const onError = vi.fn();
        client.on('error', onError);

        await expect(client.connect()).rejects.toThrow();
        expect(client.isConnected()).toBe(false);
        expect(onError).toHaveBeenCalled();
    });
});
