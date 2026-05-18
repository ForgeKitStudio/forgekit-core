/**
 * Runtime channel client — UDP bridge between the MCP server and the
 * running game's runtime bridge (`McpBridge` autoload).
 *
 * Responsibilities (task 8.4):
 *   - Discover the runtime port: prefer the value found in
 *     `mcp_active_port.json` (key `runtime`) when a UDP probe to the
 *     hint succeeds, otherwise scan the assigned 6020-6029 range from
 *     low to high. The probe sends an empty `runtime.handshake` packet
 *     and waits up to 500 ms for any datagram in reply.
 *   - Open a UDP socket via `node:dgram` and frame JSON-RPC 2.0
 *     messages one-per-datagram.
 *   - Run a local size-gate before transmission (`PACKET_TOO_LARGE`,
 *     code -32005) mirroring the GDScript-side rejection in
 *     `addons/forgekit_core/mcp/runtime_bridge/packet_parser.gd`. The
 *     gate runs on the encoded payload so the server never sees a
 *     datagram it would reject anyway.
 *   - Correlate request and response by JSON-RPC `id` through a
 *     pending-requests map.
 *   - Send `runtime.heartbeat` every `heartbeatIntervalMs` (default
 *     10 000 ms). The runtime bridge keeps no persistent connection
 *     state, so a missed heartbeat tears down the in-process state and
 *     starts a "reconnect-by-handshake" loop with the canonical
 *     `1s → 2s → 4s → 8s → 16s → 32s → 60s` schedule (shared with the
 *     editor channel).
 *   - Attach a trace context (`trace.{trace_id, span_id}`) to every
 *     outgoing packet so log lines can be correlated across processes.
 *     The format mirrors `mcp_bridge.gd::observe_packet` — 8 lowercase
 *     hex chars for `trace_id`, 4 for `span_id`.
 *   - Optional auth: when `authToken` is supplied, the first request
 *     after the socket binds is `runtime.handshake({auth_token})`. The
 *     server must reply with `result.authenticated === true` (or omit
 *     the field). Any other shape, an explicit `authenticated: false`,
 *     or a JSON-RPC error envelope causes the client to emit `error`
 *     and `disconnect()`.
 *
 * The class extends `node:events.EventEmitter` and emits three events
 * with the same semantics as {@link EditorWsClient}: `connect`,
 * `disconnect`, `error`.
 */

import { EventEmitter } from 'node:events';
import * as dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';

import {
    ACTIVE_PORT_FILE_NAME,
    RUNTIME_RANGE,
    type ActivePortsFile,
    type PortRange,
    readActivePorts,
} from '../port_scanner.js';
import { AutoReconnect } from '../auto_reconnect.js';
import { loadAuthToken } from '../auth_verifier.js';
import type { Metrics } from '../metrics.js';
import {
    DEFAULT_MAX_PACKET_BYTES,
    PACKET_TOO_LARGE_CODE,
    PACKET_TOO_LARGE_MESSAGE,
    parsePacketSize,
} from '../tools/runtime_bridge/packet_parser.js';
import type { JsonlLogger } from '../observability/jsonl_logger.js';

/** Component name written into JSONL log lines emitted by this client. */
const LOG_COMPONENT = 'runtime_udp_client' as const;

/** Signature of the UDP probe used to discover listening runtime ports. */
export type UdpProbe = (host: string, port: number) => Promise<boolean>;

/** Signature of the UDP socket factory used by the client. */
export type UdpSocketFactory = () => dgram.Socket;

const HEARTBEAT_INTERVAL_DEFAULT_MS = 10_000;
const HEARTBEAT_TIMEOUT_DEFAULT_MS = 30_000;
const HEARTBEAT_METHOD = 'runtime.heartbeat';
const HANDSHAKE_METHOD = 'runtime.handshake';
const UDP_PROBE_TIMEOUT_MS = 500;

export interface RuntimeUdpClientOptions {
    readonly metrics: Metrics;
    /** Hostname / IP to send to. Defaults to `127.0.0.1`. */
    readonly host?: string;
    /** Port range to scan if the active-port file does not help. Defaults to `RUNTIME_RANGE`. */
    readonly range?: PortRange;
    /** Path of the bridge's `mcp_active_port.json`. Defaults to `user://mcp_active_port.json`. */
    readonly activePortFilePath?: string;
    /** Optional override for the UDP probe. Used by tests. */
    readonly udpProbe?: UdpProbe;
    /** Optional override for the UDP socket factory. Used by tests. */
    readonly udpSocketFactory?: UdpSocketFactory;

    /** Heartbeat interval. Default 10 000 ms. Set `enableHeartbeat: false` to disable. */
    readonly heartbeatIntervalMs?: number;
    /** Heartbeat reply timeout. Default 30 000 ms. */
    readonly heartbeatTimeoutMs?: number;
    /** Whether to start the heartbeat after `connect()`. Default `true`. */
    readonly enableHeartbeat?: boolean;

    /** Whether to auto-reconnect after a heartbeat timeout. Default `true`. */
    readonly enableAutoReconnect?: boolean;
    /** Optional pre-built {@link AutoReconnect} instance. */
    readonly autoReconnect?: AutoReconnect;

    /** When set, the client sends `runtime.handshake({auth_token})` on connect. */
    readonly authToken?: string;

    /**
     * Optional project root used to discover the auth token from
     * `addons/forgekit_core/mcp/runtime_config.tres`. When `authToken`
     * is not provided, the client calls
     * `loadAuthToken('runtime', { projectRoot })` lazily on `connect()`
     * and uses the result as the handshake token. Pass an explicit
     * `authToken` to bypass the lookup.
     */
    readonly projectRoot?: string;

    /** Maximum encoded datagram size in bytes. Default 65507 (IPv4 UDP ceiling). */
    readonly maxPacketBytes?: number;

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

type RuntimeUdpEventName = 'connect' | 'disconnect' | 'error';

/** JSON-RPC error attached to the rejection thrown by `send()`. */
type SendError = Error & {
    code?: number;
    data?: { size: number; limit: number; suggestion: string };
};

/**
 * UDP transport client for the Godot runtime bridge.
 */
export class RuntimeUdpClient extends EventEmitter {
    private readonly metrics: Metrics;
    private readonly host: string;
    private readonly range: PortRange;
    private readonly activePortFilePath: string;
    private readonly udpProbe: UdpProbe;
    private readonly udpSocketFactory: UdpSocketFactory;

    private readonly heartbeatIntervalMs: number;
    private readonly heartbeatTimeoutMs: number;
    private readonly enableHeartbeat: boolean;

    private readonly enableAutoReconnect: boolean;
    private readonly autoReconnect: AutoReconnect;

    private readonly authToken: string | undefined;
    private readonly projectRoot: string | undefined;
    /**
     * Lazy cache for `loadAuthToken('runtime', { projectRoot })`.
     * `null` means "lookup performed and the config declared no token
     * (dev mode)"; `undefined` means "not yet looked up". Filled in on
     * the first `connectOnce()` so `connect()` never reads the
     * filesystem unless an actual connection attempt is being made.
     */
    private resolvedAuthToken: string | null | undefined;
    private readonly maxPacketBytes: number;
    private readonly logger: JsonlLogger | undefined;

    private socket: dgram.Socket | undefined;
    private connected = false;
    /**
     * `true` once the user has called `disconnect()`. Auto-reconnect
     * respects this flag so a manual `disconnect()` stops the
     * reconnect loop dead.
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

    constructor(options: RuntimeUdpClientOptions) {
        super();
        this.metrics = options.metrics;
        this.host = options.host ?? '127.0.0.1';
        this.range = options.range ?? RUNTIME_RANGE;
        this.activePortFilePath =
            options.activePortFilePath ?? `user://${ACTIVE_PORT_FILE_NAME}`;
        this.udpProbe = options.udpProbe ?? defaultUdpProbe;
        this.udpSocketFactory =
            options.udpSocketFactory ?? (() => dgram.createSocket('udp4'));

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
        this.maxPacketBytes = options.maxPacketBytes ?? DEFAULT_MAX_PACKET_BYTES;
        this.logger = options.logger;
    }

    /** Strongly typed `on` overload for IDE help. */
    override on(event: RuntimeUdpEventName, listener: (...args: unknown[]) => void): this {
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
     * Open the socket, perform the optional handshake, and start the
     * heartbeat loop. Resolves once the client is ready for tool calls
     * (i.e. the handshake has succeeded). Rejects on any error during
     * port discovery, bind, or handshake.
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
     * Rejects when the encoded payload exceeds the size limit
     * (`PACKET_TOO_LARGE`), when the server replies with an `error`
     * envelope, when the socket closes before the reply arrives, or
     * when the client is not connected.
     */
    async send(method: string, params: unknown): Promise<unknown> {
        if (!this.connected || this.socket === undefined || this.resolvedPort === undefined) {
            throw new Error('RuntimeUdpClient is not connected.');
        }
        return await this.sendRpcOnSocket(this.socket, this.resolvedPort, method, params);
    }

    private async connectOnce(): Promise<void> {
        if (this.connecting) {
            throw new Error('RuntimeUdpClient is already connecting.');
        }
        this.connecting = true;
        try {
            // Resolve the auth token before opening the socket. An
            // explicit `authToken` always wins; otherwise we consult
            // `addons/forgekit_core/mcp/runtime_config.tres` under
            // `projectRoot` once and cache the result so reconnect
            // attempts skip the filesystem read.
            const token = await this.resolveAuthToken();
            const port = await this.discoverRuntimePort();
            this.resolvedPort = port;

            const socket = this.udpSocketFactory();
            await this.bindSocket(socket);
            this.attachSocketLifecycle(socket);
            this.socket = socket;

            // Run the auth handshake (if configured) BEFORE marking the
            // client as connected. The auth gate must complete first so
            // that `send()` callers cannot leak through.
            if (token !== null && token !== '') {
                try {
                    await this.performHandshake(socket, port, token);
                } catch (err) {
                    // The handshake helper already terminated the socket
                    // and emitted 'error'; drop our reference so the
                    // close handler skips reconnect.
                    this.socket = undefined;
                    throw err;
                }
            }

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
     *      `loadAuthToken('runtime', { projectRoot })`. The result is
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
            this.resolvedAuthToken = await loadAuthToken('runtime', {
                projectRoot: this.projectRoot,
            });
        }
        return this.resolvedAuthToken ?? null;
    }

    /**
     * Discover the runtime port:
     *   1. Read `mcp_active_port.json`. If `runtime` is set and the
     *      probe says it answers, use it.
     *   2. Otherwise scan the configured range from low to high and
     *      return the first probe that succeeds.
     */
    private async discoverRuntimePort(): Promise<number> {
        let active: ActivePortsFile | undefined;
        try {
            active = await readActivePorts(this.activePortFilePath);
        } catch {
            // Missing or invalid file is non-fatal — we fall back to
            // scanning the range.
            active = undefined;
        }

        if (active !== undefined) {
            const hint = active.runtime;
            if (hint >= 0 && hint <= 65535) {
                if (await this.udpProbe(this.host, hint)) {
                    return hint;
                }
            }
        }

        for (let port = this.range.start; port <= this.range.end; port++) {
            if (await this.udpProbe(this.host, port)) {
                return port;
            }
        }

        throw new Error(
            `No listening runtime port found in range [${this.range.start}, ${this.range.end}] (host=${this.host}).`,
        );
    }

    private bindSocket(socket: dgram.Socket): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const onError = (err: Error) => {
                socket.removeListener('listening', onListening);
                reject(err);
            };
            const onListening = () => {
                socket.removeListener('error', onError);
                resolve();
            };
            socket.once('error', onError);
            socket.once('listening', onListening);
            // Bind to an ephemeral local port so the OS routes replies
            // back to us. Bound on 127.0.0.1 because the runtime bridge
            // is loopback-only by default.
            socket.bind(0, '127.0.0.1');
        });
    }

    private attachSocketLifecycle(socket: dgram.Socket): void {
        socket.on('message', (msg) => this.handleMessage(msg));
        socket.on('error', (err) => {
            this.emit('error', err);
        });
    }

    private async performHandshake(socket: dgram.Socket, port: number, token: string): Promise<void> {
        const params = { auth_token: token };
        let result: unknown;
        try {
            result = await this.sendRpcOnSocket(socket, port, HANDSHAKE_METHOD, params);
        } catch (err) {
            const wrapped = err instanceof Error ? err : new Error(String(err));
            this.emit('error', wrapped);
            try {
                socket.close();
            } catch {
                // ignore
            }
            throw wrapped;
        }

        const ok = isHandshakeOk(result);
        if (!ok) {
            const error = new Error('Runtime handshake rejected: not authenticated.');
            this.emit('error', error);
            try {
                socket.close();
            } catch {
                // ignore
            }
            throw error;
        }
    }

    /**
     * Low-level JSON-RPC send that operates on an explicit socket and
     * port. Used both by the public `send()` (after the handshake) and
     * by `performHandshake()` (before the client is marked connected).
     *
     * Encodes the JSON-RPC envelope, runs the local size gate, and only
     * transmits when the encoded payload fits inside the configured
     * `maxPacketBytes` ceiling.
     */
    private sendRpcOnSocket(
        socket: dgram.Socket,
        port: number,
        method: string,
        params: unknown,
    ): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            const id = this.nextRequestId++;
            const trace = this.resolveTraceForOutgoing(params);
            const envelope = {
                jsonrpc: '2.0',
                method,
                params,
                id,
                trace,
            };
            const payload = JSON.stringify(envelope);
            const encoded = Buffer.from(payload, 'utf8');

            const gate = parsePacketSize(encoded.length, this.maxPacketBytes);
            if (!gate.ok) {
                const err = new Error(
                    `${PACKET_TOO_LARGE_MESSAGE}: encoded payload ${encoded.length} exceeds limit ${this.maxPacketBytes}.`,
                ) as SendError;
                err.code = PACKET_TOO_LARGE_CODE;
                err.data = gate.error.data;
                reject(err);
                return;
            }

            this.pending.set(id, { resolve, reject, trace, method });
            this.logOutbound(method, trace, id);
            try {
                socket.send(encoded, port, this.host, (sendErr) => {
                    if (sendErr !== undefined && sendErr !== null) {
                        this.pending.delete(id);
                        reject(sendErr);
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
     * otherwise mints a fresh pair so every packet is correlatable
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
        return this.mintTraceContext();
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

    private mintTraceContext(): { trace_id: string; span_id: string } {
        return {
            trace_id: randomHexLowercase(8),
            span_id: randomHexLowercase(4),
        };
    }

    private handleMessage(raw: Buffer): void {
        const text = raw.toString('utf8');
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch (err) {
            this.emit(
                'error',
                err instanceof Error
                    ? err
                    : new Error(`Failed to parse incoming UDP datagram: ${String(err)}`),
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
            // layer.
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
            const err = new Error(`${errMsg} (code ${code})`) as SendError;
            err.code = code;
            (err as Error & { data?: unknown }).data = message.error.data;
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
            if (!this.connected || this.socket === undefined || this.resolvedPort === undefined) {
                return;
            }
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
            const envelope = {
                jsonrpc: '2.0',
                method: HEARTBEAT_METHOD,
                id,
                trace: this.mintTraceContext(),
            };
            try {
                this.socket.send(
                    Buffer.from(JSON.stringify(envelope), 'utf8'),
                    this.resolvedPort,
                    this.host,
                );
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
                this.socket.removeAllListeners('error');
                this.socket.close();
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
    // the contract used by the GDScript runtime bridge.
    if (!('authenticated' in record)) {
        return true;
    }
    return record.authenticated === true;
}

const HEX_ALPHABET = '0123456789abcdef';

function randomHexLowercase(width: number): string {
    const buf = randomBytes(width);
    let out = '';
    for (let i = 0; i < width; i++) {
        out += HEX_ALPHABET[buf[i]! & 0x0f];
    }
    return out;
}

/**
 * Default UDP probe — sends an empty `runtime.handshake` datagram and
 * resolves to `true` when any reply arrives within 500 ms.
 *
 * The packet carries an empty `params` envelope plus a freshly-minted
 * trace context so it is shaped exactly like a regular runtime
 * datagram (the runtime bridge's `observe_packet()` walks every packet
 * for a trace field).
 *
 * The probe binds an ephemeral UDP socket so the kernel routes the
 * reply back to the sender. The socket is closed before the promise
 * resolves so callers do not need to track it.
 */
async function defaultUdpProbe(host: string, port: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
        const socket = dgram.createSocket('udp4');
        let settled = false;
        const done = (alive: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            try {
                socket.close();
            } catch {
                // ignore
            }
            resolve(alive);
        };
        socket.once('message', () => done(true));
        socket.once('error', () => done(false));
        const timer = setTimeout(() => done(false), UDP_PROBE_TIMEOUT_MS);
        timer.unref?.();
        socket.bind(0, '127.0.0.1', () => {
            const probePayload = JSON.stringify({
                jsonrpc: '2.0',
                method: HANDSHAKE_METHOD,
                params: {},
                id: 0,
                trace: {
                    trace_id: randomHexLowercase(8),
                    span_id: randomHexLowercase(4),
                },
            });
            try {
                socket.send(Buffer.from(probePayload, 'utf8'), port, host, (err) => {
                    if (err !== undefined && err !== null) {
                        done(false);
                    }
                });
            } catch {
                done(false);
            }
        });
    });
}
