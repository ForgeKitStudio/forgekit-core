/**
 * Channel router — `ChannelDispatcher` implementation for the stdio
 * bridge.
 *
 * For every incoming JSON-RPC method the router:
 *   1. Looks the method up in `profiles.tools` by `name`.
 *   2. Reads the matching tool's `channel`.
 *   3. Forwards the call to the matching transport client:
 *        - `editor`  → `editorClient.send(method, params)`
 *        - `runtime` → `runtimeClient.send(method, params)`
 *        - `cli`     → `cliExecutor.invoke(method, params)`
 *        - `cross`   → `crossExecutor.invoke(method, params)`
 *
 * Failure modes are surfaced as the `DispatchResult` discriminants the
 * stdio bridge already understands:
 *   - Unknown method      → `DispatchError {code: -32601, message: "Method not found"}`.
 *   - Editor / runtime client reporting `isConnected() === false` →
 *     `DispatchChannelUnavailable {channel}`. The bridge translates
 *     this into `editor_channel_unavailable` /
 *     `runtime_channel_unavailable` JSON-RPC errors.
 *   - Send/invoke that exceeds `timeoutMs` →
 *     `DispatchError {code: -32001, message: "channel_timeout",
 *                     data: {channel, method, elapsed_ms}}`.
 *
 * The router never throws: any exception raised by a downstream client
 * is converted into `DispatchError {code: -32603}` so the bridge can
 * still respond.
 */

import type {
    ChannelDispatcher,
    DispatchResult,
} from '../stdio_bridge.js';
import type { ProfilesFile, ToolChannel } from '../profiles.js';

/** Editor (WebSocket) client contract used by the router. */
export interface EditorChannelClient {
    send(method: string, params: unknown): Promise<unknown>;
    isConnected(): boolean;
}

/** Runtime (UDP) client contract used by the router. */
export interface RuntimeChannelClient {
    send(method: string, params: unknown): Promise<unknown>;
    isConnected(): boolean;
}

/** CLI (spawn-godot-headless) executor contract used by the router. */
export interface CliChannelExecutor {
    invoke(method: string, params: unknown): Promise<unknown>;
}

/**
 * Cross-channel executor — handles tools whose implementation spans
 * multiple transports (e.g. `modules.activate_license` writes to disk
 * and also notifies the editor).
 */
export interface CrossChannelExecutor {
    invoke(method: string, params: unknown): Promise<unknown>;
}

export interface ChannelRouterOptions {
    readonly profiles: ProfilesFile;
    readonly editorClient: EditorChannelClient;
    readonly runtimeClient: RuntimeChannelClient;
    readonly cliExecutor: CliChannelExecutor;
    readonly crossExecutor: CrossChannelExecutor;
    /** Per-call timeout in milliseconds. Default: 30 000 ms. */
    readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Routes JSON-RPC calls to the editor, runtime, CLI, or cross-channel
 * client based on the static `channel` attribute declared in
 * `profiles.json`.
 */
export class ChannelRouter implements ChannelDispatcher {
    private readonly profiles: ProfilesFile;
    private readonly editorClient: EditorChannelClient;
    private readonly runtimeClient: RuntimeChannelClient;
    private readonly cliExecutor: CliChannelExecutor;
    private readonly crossExecutor: CrossChannelExecutor;
    private readonly timeoutMs: number;
    private readonly toolIndex: Map<string, ToolChannel>;

    constructor(options: ChannelRouterOptions) {
        this.profiles = options.profiles;
        this.editorClient = options.editorClient;
        this.runtimeClient = options.runtimeClient;
        this.cliExecutor = options.cliExecutor;
        this.crossExecutor = options.crossExecutor;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        // Build the lookup table once; profiles.tools is stable for the
        // lifetime of the router instance.
        this.toolIndex = new Map();
        for (const tool of this.profiles.tools) {
            // First entry wins on duplicates so the manifest order is
            // honoured. `profiles.json` validation already prevents most
            // collisions, but we stay defensive here.
            if (!this.toolIndex.has(tool.name)) {
                this.toolIndex.set(tool.name, tool.channel);
            }
        }
    }

    async dispatch(method: string, params: unknown): Promise<DispatchResult> {
        const channel = this.toolIndex.get(method);
        if (channel === undefined) {
            return {
                kind: 'error',
                code: -32601,
                message: 'Method not found',
                data: { method },
            };
        }

        switch (channel) {
            case 'editor':
                return this.callTransport('editor', method, params, () =>
                    this.invokeEditor(method, params),
                );
            case 'runtime':
                return this.callTransport('runtime', method, params, () =>
                    this.invokeRuntime(method, params),
                );
            case 'cli':
                return this.callTransport('cli', method, params, () =>
                    this.cliExecutor.invoke(method, params),
                );
            case 'cross':
                return this.callTransport('cross', method, params, () =>
                    this.crossExecutor.invoke(method, params),
                );
            default: {
                const never: never = channel;
                return {
                    kind: 'error',
                    code: -32603,
                    message: 'Internal error',
                    data: { detail: `Unknown channel: ${String(never)}` },
                };
            }
        }
    }

    private invokeEditor(method: string, params: unknown): Promise<unknown> | DispatchResult {
        if (!this.editorClient.isConnected()) {
            return { kind: 'channel-unavailable', channel: 'editor' };
        }
        return this.editorClient.send(method, params);
    }

    private invokeRuntime(method: string, params: unknown): Promise<unknown> | DispatchResult {
        if (!this.runtimeClient.isConnected()) {
            return { kind: 'channel-unavailable', channel: 'runtime' };
        }
        return this.runtimeClient.send(method, params);
    }

    /**
     * Wraps the per-channel call with timeout enforcement and error
     * shaping. `factory` may either return a Promise (the normal path)
     * or a synchronous `DispatchResult` (channel-unavailable short
     * circuit).
     */
    private async callTransport(
        channel: ToolChannel,
        method: string,
        _params: unknown,
        factory: () => Promise<unknown> | DispatchResult,
    ): Promise<DispatchResult> {
        let raw: Promise<unknown> | DispatchResult;
        try {
            raw = factory();
        } catch (err) {
            return errorFromException(err);
        }

        // Synchronous short-circuit — channel-unavailable is the only such
        // result a factory may return today.
        if (!isPromiseLike(raw)) {
            return raw;
        }

        const startedAt = Date.now();
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<DispatchResult>((resolve) => {
            timeoutHandle = setTimeout(() => {
                resolve({
                    kind: 'error',
                    code: -32001,
                    message: 'channel_timeout',
                    data: {
                        channel,
                        method,
                        elapsed_ms: Date.now() - startedAt,
                    },
                });
            }, this.timeoutMs);
        });

        const successPromise = (async (): Promise<DispatchResult> => {
            try {
                const value = await raw;
                return { kind: 'ok', result: value };
            } catch (err) {
                return errorFromException(err);
            }
        })();

        try {
            return await Promise.race([successPromise, timeoutPromise]);
        } finally {
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
            }
        }
    }
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

function errorFromException(err: unknown): DispatchResult {
    const message = err instanceof Error ? err.message : String(err);
    return {
        kind: 'error',
        code: -32603,
        message: 'Internal error',
        data: { detail: message },
    };
}
