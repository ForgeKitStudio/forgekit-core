/**
 * Editor channel client — WebSocket bridge between the MCP server and
 * the Godot editor plugin.
 *
 * Responsibilities (task 8.3):
 *   - Discover the editor port: prefer the value found in
 *     `mcp_active_port.json` written by the editor plugin, otherwise
 *     scan the assigned 6010-6019 range from low to high and pick the
 *     first listening port.
 *   - Open a `ws://127.0.0.1:<port>` connection and frame JSON-RPC 2.0
 *     messages one-per-WebSocket-frame.
 *   - Correlate request and response by JSON-RPC `id` through a
 *     pending-requests map.
 *   - Send `runtime.heartbeat` every `heartbeatIntervalMs` (default
 *     10 000 ms) and tear down the connection if no reply arrives
 *     within `heartbeatTimeoutMs` (default 30 000 ms).
 *   - Auto-reconnect via the shared {@link AutoReconnect} manager so
 *     the canonical `1s → 2s → 4s → 8s → 16s → 32s → 60s` schedule
 *     applies and `Metrics.mcp.reconnect.*` is updated.
 *   - Optional auth: when `authToken` is supplied, the first request
 *     after the WebSocket opens is `runtime.handshake({auth_token})`.
 *     The server must reply with `result.authenticated === true` (or
 *     omit the field). Any other shape, an explicit
 *     `authenticated: false`, or a JSON-RPC error envelope causes the
 *     client to emit `error` and `disconnect()`.
 *
 * The class extends `node:events.EventEmitter` and emits three events:
 *   - `connect`    — handshake (if any) succeeded; the client is ready
 *                    to forward `tools/call` requests.
 *   - `disconnect` — the underlying socket closed (locally or remotely)
 *                    or a heartbeat timeout fired.
 *   - `error`      — any non-recoverable error: handshake failure,
 *                    socket-level error, JSON parsing failure on a
 *                    server-pushed frame.
 *
 * The implementation uses dependency injection for the WebSocket
 * factory and the TCP probe so tests can avoid binding real network
 * sockets when the assertion does not need them. Production callers
 * pick up the defaults exported from `src/port_scanner.ts` /
 * the `ws` package.
 */

import { EventEmitter } from 'node:events';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

import {
    ACTIVE_PORT_FILE_NAME,
    EDITOR_RANGE,
    type ActivePortsFile,
    type PortRange,
    readActivePorts,
} from '../port_scanner.js';
import { AutoReconnect } from '../auto_reconnect.js';
import { loadAuthToken } from '../auth_verifier.js';
import type { Metrics } from '../metrics.js';
import type { JsonlLogger } from '../observability/jsonl_logger.js';

/** Component name written into JSONL log lines emitted by this client. */
const LOG_COMPONENT = 'editor_ws_client' as const;

/** Signature of the TCP probe used to discover listening ports. */
export type TcpProbe = (host: string, port: number) => Promise<boolean>;

/** Signature of the WebSocket factory used by the client. */
export type WebSocketFactory = (url: string) => WebSocket;

const HEARTBEAT_INTERVAL_DEFAULT_MS = 10_000;
const HEARTBEAT_TIMEOUT_DEFAULT_MS = 30_000;
const HEARTBEAT_METHOD = 'runtime.heartbeat';
const HANDSHAKE_METHOD = 'runtime.handshake';
const TCP_PROBE_TIMEOUT_MS = 250;

export interface EditorWsClientOptions {
    readonly metrics: Metrics;
    /** Hostname / IP to connect to. Defaults to `127.0.0.1`. */
    readonly host?: string;
    /** Port range to scan if the active-port file does not help. Defaults to `EDITOR_RANGE`. */
    readonly range?: PortRange;
    /** Path of the editor's `mcp_active_port.json`. Defaults to `user://mcp_active_port.json`. */
    readonly activePortFilePath?: string;
    /** Optional override for the TCP probe. Used by tests. */
    readonly tcpProbe?: TcpProbe;
    /** Optional override for the WebSocket factory. Used by tests. */
    readonly webSocketFactory?: WebSocketFactory;

    /** Heartbeat interval. Default 10 000 ms. Set `enableHeartbeat: false` to disable. */
    readonly heartbeatIntervalMs?: number;
    /** Heartbeat reply timeout. Default 30 000 ms. */
    readonly heartbeatTimeoutMs?: number;
    /** Whether to start the heartbeat after `connect()`. Default `true`. */
    readonly enableHeartbeat?: boolean;

    /** Whether to auto-reconnect after the socket drops. Default `true`. */
    readonly enableAutoReconnect?: boolean;
    /** Optional pre-built {@link AutoReconnect} instance. */
    readonly autoReconnect?: AutoReconnect;

    /** When set, the client sends `runtime.handshake({auth_token})` on connect. */
    readonly authToken?: string;

    /**
     * Optional project root used to discover the auth token from
     * `addons/forgekit_core/mcp/plugin_config.tres`. When `authToken`
     * is not provided, the client calls
     * `loadAuthToken('editor', { projectRoot })` lazily on `connect()`
     * and uses the result as the handshake token. Pass an explicit
     * `authToken` to bypass the lookup.
     */
    readonly projectRoot?: string;

    /**
     * Optional structured logger. When set, the client emits one JSONL
     * line per outgoing message (`direction: "outbound"`) and one per
     * matched reply (`direction: "inbound"`), carrying the
     * `trace.{trace_id, span_id}` envelope attached to the request.
     */
    readonly logger?: JsonlLogger;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    /** Trace context recorded at send time, used for inbound logging. */
    trace?: { trace_id: string; span_id: string };
    /** Method name recorded at send time, used for inbound logging. */
    method?: string;
}

type EditorWsEventName = 'connect' | 'disconnect' | 'error';

/**
 * WebSocket transport client for the Godot editor channel.
 */
export class EditorWsClient extends EventEmitter {
    private readonly metrics: Metrics;
    private readonly host: string;
    private readonly range: PortRange;
    private readonly activePortFilePath: string;
    private readonly tcpProbe: TcpProbe;
    private readonly webSocketFactory: WebSocketFactory;

    private readonly heartbeatIntervalMs: number;
    private readonly heartbeatTimeoutMs: number;
    private readonly enableHeartbeat: boolean;

    private readonly enableAutoReconnect: boolean;
    private readonly autoReconnect: AutoReconnect;

    private readonly authToken: string | undefined;
    private readonly projectRoot: string | undefined;
    private readonly logger: JsonlLogger | undefined;
    /**
     * Lazy cache for `loadAuthToken('editor', { projectRoot })`. `null`
     * means "lookup performed and the config declared no token (dev
     * mode)"; `undefined` means "not yet looked up". Filled in on the
     * first `connectOnce()` so `connect()` never reads the filesystem
     * unless an actual connection attempt is being made.
     */
    private resolvedAuthToken: string | null | undefined;

    private socket: WebSocket | undefined;
    private connected = false;
    /**
     * `true` once the user has called `disconnect()` or the constructor.
     * Auto-reconnect respects this flag so a manual `disconnect()` stops
     * the reconnect loop dead.
     */
    private terminated = false;
    private connecting = false;

    private nextRequestId = 1;
    private readonly pending = new Map<number, PendingRequest>();

    private heartbeatTimer: NodeJS.Timeout | undefined;
    private heartbeatDeadline: NodeJS.Timeout | undefined;
    private heartbeatInFlightId: number | undefined;

    private reconnectTimer: NodeJS.Timeout | undefined;
    private resolvedPort: number | undefined;

    constructor(options: EditorWsClientOptions) {
        super();
        this.metrics = options.metrics;
        this.host = options.host ?? '127.0.0.1';
        this.range = options.range ?? EDITOR_RANGE;
        this.activePortFilePath =
            options.activePortFilePath ?? `user://${ACTIVE_PORT_FILE_NAME}`;
        this.tcpProbe = options.tcpProbe ?? defaultTcpProbe;
        this.webSocketFactory =
            options.webSocketFactory ?? ((url: string) => new WebSocket(url));

        this.heartbeatIntervalMs =
            options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_DEFAULT_MS;
        this.heartbeatTimeoutMs =
            options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_DEFAULT_MS;
        this.enableHeartbeat = options.enableHeartbeat ?? true;

        this.enableAutoReconnect = options.enableAutoReconnect ?? true;
        this.autoReconnect =
            options.autoReconnect ?? new AutoReconnect(this.metrics);

        this.authToken = options.authToken;
        this.projectRoot = options.projectRoot;
        this.logger = options.logger;
    }

    /** Strongly typed `on` overload for IDE help. */
    override on(event: EditorWsEventName, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener);
    }

    /** True between a successful `connect()` (handshake included) and the next disconnect. */
    isConnected(): boolean {
        return this.connected;
    }

    /** Last port the client successfully connected to (or attempted). Useful for logs and tests. */
    get targetPort(): number | undefined {
        return this.resolvedPort;
    }

    /**
     * Open the WebSocket, perform the optional handshake, and start the
     * heartbeat loop. Resolves once the client is ready for tool calls
     * (i.e. the handshake has succeeded). Rejects on any error during
     * port discovery, dial-up, or handshake.
     */
    async connect(): Promise<void> {
        this.terminated = false;
        await this.connectOnce();
    }

    /**
     * Tear down the socket, cancel timers, reject all pending requests
     * and stop the auto-reconnect loop.
     */
    disconnect(): void {
        this.terminated = true;
        if (this.reconnectTimer !== undefined) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        this.tearDownConnection(new Error('Connection closed by client.'));
    }

    /**
     * Send a JSON-RPC 2.0 request and resolve with the `result` field.
     * Rejects when the server replies with an `error` envelope, when
     * the socket closes before the reply arrives, or when the client
     * is not connected.
     */
    async send(method: string, params: unknown): Promise<unknown> {
        if (!this.connected || this.socket === undefined) {
            throw new Error('EditorWsClient is not connected.');
        }
        return await this.sendRpcOnSocket(this.socket, method, params);
    }

    private async connectOnce(): Promise<void> {
        if (this.connecting) {
            throw new Error('EditorWsClient is already connecting.');
        }
        this.connecting = true;
        try {
            // Resolve the auth token before opening the socket. An
            // explicit `authToken` always wins; otherwise we consult
            // `addons/forgekit_core/mcp/plugin_config.tres` under
            // `projectRoot` once and cache the result so reconnect
            // attempts skip the filesystem read.
            const token = await this.resolveAuthToken();
            const port = await this.discoverEditorPort();
            this.resolvedPort = port;
            const url = `ws://${this.host}:${port}`;
            const ws = this.webSocketFactory(url);
            await this.openSocket(ws);

            // Attach the message + lifecycle listeners BEFORE the
            // handshake so the reply does not arrive before the client
            // is ready to demux it. `handleClose` checks the `connected`
            // flag so it skips auto-reconnect / `disconnect` emission
            // when the socket closes during the pre-connect handshake.
            this.attachSocketLifecycle(ws);

            // Run the handshake (if configured) BEFORE marking the
            // client as connected — the auth gate must complete first
            // so that `send()` callers cannot leak through.
            if (token !== null && token !== '') {
                this.socket = ws;
                try {
                    await this.performHandshake(ws, token);
                } catch (err) {
                    // The handshake helper already terminated the socket
                    // and emitted 'error'; drop our reference so the
                    // close handler sees `socket === undefined` and
                    // skips reconnect.
                    this.socket = undefined;
                    throw err;
                }
            }

            this.socket = ws;
            this.connected = true;
            this.autoReconnect.onConnected();
            this.startHeartbeat();
            this.emit('connect');
        } finally {
            this.connecting = false;
        }
    }

    /**
     * Resolve the auth token to use for the next handshake.
     *
     * Precedence:
     *   1. An explicit `authToken` constructor option always wins.
     *   2. Otherwise, when `projectRoot` is set, consult
     *      `loadAuthToken('editor', { projectRoot })`. The result is
     *      cached so reconnect attempts skip the filesystem read.
     *   3. Otherwise, return `null` (auth disabled / dev mode).
     */
    private async resolveAuthToken(): Promise<string | null> {
        if (this.authToken !== undefined && this.authToken !== '') {
            return this.authToken;
        }
        if (this.authToken === '') {
            return null;
        }
        if (this.projectRoot === undefined) {
            return null;
        }
        if (this.resolvedAuthToken === undefined) {
            this.resolvedAuthToken = await loadAuthToken('editor', {
                projectRoot: this.projectRoot,
            });
        }
        return this.resolvedAuthToken ?? null;
    }

    /**
     * Discover the editor port:
     *   1. Read `mcp_active_port.json`. If `editor` is set and the
     *      probe says it is listening, use it.
     *   2. Otherwise scan the configured range from low to high and
     *      return the first probe that succeeds.
     */
    private async discoverEditorPort(): Promise<number> {
        let active: ActivePortsFile | undefined;
        try {
            active = await readActivePorts(this.activePortFilePath);
        } catch {
            // Missing or invalid file is non-fatal — we fall back to
            // scanning the range.
            active = undefined;
        }

        if (active !== undefined) {
            const hint = active.editor;
            if (hint >= 0 && hint <= 65535) {
                if (await this.tcpProbe(this.host, hint)) {
                    return hint;
                }
            }
        }

        for (let port = this.range.start; port <= this.range.end; port++) {
            if (await this.tcpProbe(this.host, port)) {
                return port;
            }
        }

        throw new Error(
            `No listening editor port found in range [${this.range.start}, ${this.range.end}] (host=${this.host}).`,
        );
    }

    private openSocket(ws: WebSocket): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const onOpen = () => {
                ws.removeListener('error', onError);
                resolve();
            };
            const onError = (err: Error) => {
                ws.removeListener('open', onOpen);
                reject(err);
            };
            ws.once('open', onOpen);
            ws.once('error', onError);
        });
    }

    private attachSocketLifecycle(ws: WebSocket): void {
        ws.on('message', (raw) => this.handleMessage(raw));
        ws.on('close', () => this.handleClose(new Error('WebSocket closed by remote.')));
        ws.on('error', (err) => {
            this.emit('error', err);
        });
    }

    private async performHandshake(ws: WebSocket, token: string): Promise<void> {
        const params = { auth_token: token };
        let result: unknown;
        try {
            result = await this.sendRpcOnSocket(ws, HANDSHAKE_METHOD, params);
        } catch (err) {
            const wrapped = err instanceof Error ? err : new Error(String(err));
            this.emit('error', wrapped);
            try {
                ws.terminate();
            } catch {
                // ignore
            }
            throw wrapped;
        }

        const ok = isHandshakeOk(result);
        if (!ok) {
            const error = new Error('Editor handshake rejected: not authenticated.');
            this.emit('error', error);
            try {
                ws.terminate();
            } catch {
                // ignore
            }
            throw error;
        }
    }

    /**
     * Low-level JSON-RPC send that operates on an explicit socket
     * argument. Used both by the public `send()` (after the handshake)
     * and by `performHandshake()` (before the client is marked
     * connected).
     */
    private sendRpcOnSocket(
        ws: WebSocket,
        method: string,
        params: unknown,
    ): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            const id = this.nextRequestId++;
            const trace = this.resolveTraceForOutgoing(params);
            const payload = JSON.stringify({
                jsonrpc: '2.0',
                method,
                params,
                id,
            });
            this.pending.set(id, { resolve, reject, trace, method });
            this.logOutbound(method, trace, id);
            try {
                ws.send(payload, (err) => {
                    if (err !== undefined && err !== null) {
                        this.pending.delete(id);
                        reject(err);
                    }
                });
            } catch (err) {
                this.pending.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    /**
     * Pick the trace context for an outgoing request. Reuses the
     * upstream `params.trace` envelope when present and well-formed,
     * otherwise mints a fresh pair so every request is correlatable
     * even when the caller did not inject one.
     */
    private resolveTraceForOutgoing(params: unknown): { trace_id: string; span_id: string } {
        if (params !== null && typeof params === 'object' && !Array.isArray(params)) {
            const candidate = (params as { trace?: unknown }).trace;
            if (candidate !== null && typeof candidate === 'object') {
                const t = candidate as { trace_id?: unknown; span_id?: unknown };
                if (
                    typeof t.trace_id === 'string' &&
                    /^[0-9a-f]{8}$/.test(t.trace_id) &&
                    typeof t.span_id === 'string' &&
                    /^[0-9a-f]{4}$/.test(t.span_id)
                ) {
                    return { trace_id: t.trace_id, span_id: t.span_id };
                }
            }
        }
        return { trace_id: randomHexLowercase(8), span_id: randomHexLowercase(4) };
    }

    private logOutbound(
        method: string,
        trace: { trace_id: string; span_id: string },
        id: number,
    ): void {
        if (this.logger === undefined) {
            return;
        }
        this.logger.log('info', LOG_COMPONENT, {
            trace_id: trace.trace_id,
            span_id: trace.span_id,
            method,
            direction: 'outbound',
            request_id: id,
        });
    }

    private logInbound(
        method: string,
        trace: { trace_id: string; span_id: string },
        id: number,
        outcome: 'ok' | 'error',
        errorCode?: number,
    ): void {
        if (this.logger === undefined) {
            return;
        }
        const data: Record<string, unknown> = {
            direction: 'inbound',
            request_id: id,
            status: outcome,
        };
        if (errorCode !== undefined) {
            data.error_code = errorCode;
        }
        this.logger.log(outcome === 'ok' ? 'info' : 'error', LOG_COMPONENT, {
            trace_id: trace.trace_id,
            span_id: trace.span_id,
            method,
            ...data,
        });
    }

    private handleMessage(raw: WebSocket.RawData): void {
        const text =
            typeof raw === 'string'
                ? raw
                : Array.isArray(raw)
                    ? Buffer.concat(raw).toString('utf8')
                    : Buffer.isBuffer(raw)
                        ? raw.toString('utf8')
                        : Buffer.from(raw as ArrayBuffer).toString('utf8');

        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch (err) {
            this.emit(
                'error',
                err instanceof Error
                    ? err
                    : new Error(`Failed to parse incoming WebSocket frame: ${String(err)}`),
            );
            return;
        }

        if (parsed === null || typeof parsed !== 'object') {
            return;
        }
        const message = parsed as {
            id?: unknown;
            result?: unknown;
            error?: { code?: unknown; message?: unknown; data?: unknown };
        };
        if (typeof message.id !== 'number') {
            // Notifications and broadcasts (no `id`) are ignored at this
            // layer — higher-level subscribers can be added later.
            return;
        }
        const pending = this.pending.get(message.id);
        if (pending === undefined) {
            return;
        }
        this.pending.delete(message.id);

        // Heartbeat reply housekeeping: if this is the heartbeat we are
        // currently waiting for, clear the deadline.
        if (this.heartbeatInFlightId === message.id) {
            this.heartbeatInFlightId = undefined;
            if (this.heartbeatDeadline !== undefined) {
                clearTimeout(this.heartbeatDeadline);
                this.heartbeatDeadline = undefined;
            }
        }

        if (message.error !== undefined && message.error !== null) {
            const code = typeof message.error.code === 'number' ? message.error.code : -32603;
            const errMsg =
                typeof message.error.message === 'string'
                    ? message.error.message
                    : 'JSON-RPC error.';
            const err = new Error(`${errMsg} (code ${code})`);
            (err as Error & { code?: number; data?: unknown }).code = code;
            (err as Error & { code?: number; data?: unknown }).data = message.error.data;
            if (pending.trace !== undefined && pending.method !== undefined) {
                this.logInbound(pending.method, pending.trace, message.id, 'error', code);
            }
            pending.reject(err);
            return;
        }
        if (pending.trace !== undefined && pending.method !== undefined) {
            this.logInbound(pending.method, pending.trace, message.id, 'ok');
        }
        pending.resolve(message.result);
    }

    private startHeartbeat(): void {
        if (!this.enableHeartbeat) {
            return;
        }
        const tick = () => {
            if (!this.connected || this.socket === undefined) {
                return;
            }
            const ws = this.socket;
            const id = this.nextRequestId++;
            this.heartbeatInFlightId = id;
            this.pending.set(id, {
                resolve: () => {
                    /* handled in handleMessage */
                },
                reject: () => {
                    /* handled in handleMessage / handleClose */
                },
            });
            try {
                ws.send(JSON.stringify({ jsonrpc: '2.0', method: HEARTBEAT_METHOD, id }));
            } catch {
                this.pending.delete(id);
                this.heartbeatInFlightId = undefined;
                this.handleHeartbeatTimeout();
                return;
            }
            this.heartbeatDeadline = setTimeout(
                () => this.handleHeartbeatTimeout(),
                this.heartbeatTimeoutMs,
            );
            this.heartbeatDeadline.unref?.();
        };
        this.heartbeatTimer = setInterval(tick, this.heartbeatIntervalMs);
        this.heartbeatTimer.unref?.();
    }

    private handleHeartbeatTimeout(): void {
        this.metrics.inc('mcp.heartbeat.drops');
        this.handleClose(
            new Error(
                `runtime.heartbeat timed out after ${this.heartbeatTimeoutMs}ms.`,
            ),
        );
    }

    private handleClose(reason: Error): void {
        if (!this.connected && this.socket === undefined) {
            return;
        }
        const wasConnected = this.connected;
        this.tearDownConnection(reason);
        if (wasConnected && !this.terminated && this.enableAutoReconnect) {
            this.scheduleReconnect();
        }
    }

    private tearDownConnection(reason: Error): void {
        this.connected = false;
        this.heartbeatInFlightId = undefined;
        if (this.heartbeatTimer !== undefined) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        if (this.heartbeatDeadline !== undefined) {
            clearTimeout(this.heartbeatDeadline);
            this.heartbeatDeadline = undefined;
        }
        if (this.socket !== undefined) {
            try {
                this.socket.removeAllListeners('message');
                this.socket.removeAllListeners('close');
                this.socket.terminate();
            } catch {
                // ignore
            }
            this.socket = undefined;
        }
        // Reject all pending requests so callers do not hang.
        for (const [id, pending] of this.pending) {
            this.pending.delete(id);
            pending.reject(new Error(`Request ${id} failed: ${reason.message}`));
        }
        this.emit('disconnect', reason);
    }

    private scheduleReconnect(): void {
        if (this.terminated) {
            return;
        }
        const delay = this.autoReconnect.nextBackoffMs();
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            void this.attemptReconnect();
        }, delay);
        this.reconnectTimer.unref?.();
    }

    private async attemptReconnect(): Promise<void> {
        if (this.terminated) {
            return;
        }
        try {
            await this.connectOnce();
        } catch {
            if (!this.terminated && this.enableAutoReconnect) {
                this.scheduleReconnect();
            }
        }
    }
}

function isHandshakeOk(result: unknown): boolean {
    if (result === null || result === undefined) {
        return false;
    }
    if (typeof result !== 'object') {
        return false;
    }
    const record = result as { authenticated?: unknown };
    // Default to "authenticated" when the server omits the field, matching
    // the contract used by older runtime bridges. Setting it to anything
    // other than `true` is a hard reject.
    if (!('authenticated' in record)) {
        return true;
    }
    return record.authenticated === true;
}

/** Default TCP probe — opens a short connection and resolves to `true` if the SYN/ACK lands. */
async function defaultTcpProbe(host: string, port: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
        const socket = createConnection({ host, port });
        let settled = false;
        const done = (free: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(free);
        };
        socket.setTimeout(TCP_PROBE_TIMEOUT_MS);
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
        socket.once('timeout', () => done(false));
    });
}

const HEX_ALPHABET = '0123456789abcdef';

/**
 * Mint a freshly random lowercase hex string of `width` characters.
 * Used to assign trace and span ids when an outgoing request does not
 * already carry a `params.trace` envelope.
 */
function randomHexLowercase(width: number): string {
    const buf = randomBytes(width);
    let out = '';
    for (let i = 0; i < width; i++) {
        out += HEX_ALPHABET[buf[i]! & 0x0f];
    }
    return out;
}
