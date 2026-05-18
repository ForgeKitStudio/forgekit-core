/**
 * Dispatch logger middleware — wraps a `ChannelDispatcher` (typically
 * the `ChannelRouter`) so every JSON-RPC method gets two structured
 * JSONL log lines, before and after the dispatch, plus a trace context
 * (`{trace_id, span_id}`) injected into the forwarded params.
 *
 * Line shape (mirrors `JsonlLogger`):
 *   - before: `{ts, level: "info", component: "channel_router",
 *               trace_id, span_id, method, channel?, request_id?,
 *               data: {phase: "before"}}`
 *   - after:  `{ts, level: "info" | "error", component: "channel_router",
 *               trace_id, span_id, method, channel?, duration_ms,
 *               data: {phase: "after", status: "ok" | "error",
 *                      error_code?: number}}`
 *
 * The middleware mints a fresh trace context for every dispatch unless
 * the caller passed `params.trace.trace_id` already; in that case the
 * upstream trace id is reused but `span_id` is always re-minted because
 * each dispatch is a distinct span inside the trace.
 *
 * The `now()` injection point exists so tests can drive a deterministic
 * `duration_ms`; production uses `Date.now()`.
 */

import type {
    ChannelDispatcher,
    DispatchResult,
} from '../stdio_bridge.js';
import type { JsonlLogger } from './jsonl_logger.js';
import {
    generateSpanId,
    generateTraceId,
    type TraceContext,
} from './trace.js';

/** JSON-RPC code stdio_bridge maps `channel-unavailable` to. */
const CHANNEL_UNAVAILABLE_CODE = -32000 as const;

/** Component name written into every JSONL line. */
const COMPONENT_NAME = 'channel_router' as const;

export interface DispatchLoggerMiddlewareOptions {
    readonly logger: JsonlLogger;
    /**
     * Monotonic millisecond clock used to compute `duration_ms`. Tests
     * inject a deterministic stub; production defaults to `Date.now`.
     */
    readonly now?: () => number;
}

interface ParamsWithTrace {
    trace?: { trace_id?: unknown; span_id?: unknown };
    [key: string]: unknown;
}

/**
 * Lift `params` into a record so we can attach `trace`. Non-object
 * params (null, primitives, arrays) are passed through untouched.
 */
function isPlainObjectParams(value: unknown): value is ParamsWithTrace {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}

/**
 * Pick a trace id off the incoming params when one is already set,
 * otherwise mint a fresh 8-char hex id. Span ids are always freshly
 * minted per dispatch — every dispatch is a distinct span.
 */
function resolveTraceContext(params: unknown): TraceContext {
    const span_id = generateSpanId();
    if (isPlainObjectParams(params) && params.trace !== undefined) {
        const upstream = params.trace as { trace_id?: unknown };
        if (
            typeof upstream.trace_id === 'string' &&
            /^[0-9a-f]{8}$/.test(upstream.trace_id)
        ) {
            return { trace_id: upstream.trace_id, span_id };
        }
    }
    return { trace_id: generateTraceId(), span_id };
}

/**
 * Build the params forwarded to the wrapped dispatcher. For object
 * params the function returns a shallow clone with `trace` overridden;
 * non-object params are returned untouched (the GDScript side ignores
 * the trace context in that case).
 */
function attachTraceToParams(
    params: unknown,
    trace: TraceContext,
): unknown {
    if (!isPlainObjectParams(params)) {
        return params;
    }
    return { ...params, trace };
}

/**
 * Translate a `DispatchResult` into the `{status, error_code?}` pair
 * we record on the after-line. `channel-unavailable` is mapped to the
 * same `-32000` code stdio_bridge surfaces in the JSON-RPC envelope so
 * downstream log readers can correlate the two.
 */
function summarizeResult(
    result: DispatchResult,
): { status: 'ok' | 'error'; errorCode?: number; channel?: string } {
    switch (result.kind) {
        case 'ok':
            return { status: 'ok' };
        case 'error':
            return { status: 'error', errorCode: result.code };
        case 'channel-unavailable':
            return {
                status: 'error',
                errorCode: CHANNEL_UNAVAILABLE_CODE,
                channel: result.channel,
            };
        default: {
            const never: never = result;
            return { status: 'error', errorCode: -32603, channel: String(never) };
        }
    }
}

/**
 * Middleware decorator that adds before-/after-dispatch JSONL logging
 * and trace context injection on top of any `ChannelDispatcher`.
 */
export class DispatchLoggerMiddleware implements ChannelDispatcher {
    private readonly inner: ChannelDispatcher;
    private readonly logger: JsonlLogger;
    private readonly now: () => number;

    constructor(
        inner: ChannelDispatcher,
        options: DispatchLoggerMiddlewareOptions,
    ) {
        this.inner = inner;
        this.logger = options.logger;
        this.now = options.now ?? (() => Date.now());
    }

    async dispatch(method: string, params: unknown): Promise<DispatchResult> {
        const trace = resolveTraceContext(params);
        const forwardedParams = attachTraceToParams(params, trace);

        // ---- before-line ------------------------------------------------
        this.logger.log('info', COMPONENT_NAME, {
            trace_id: trace.trace_id,
            span_id: trace.span_id,
            method,
            phase: 'before',
        });

        const startedAt = this.now();
        let result: DispatchResult;
        try {
            result = await this.inner.dispatch(method, forwardedParams);
        } catch (err) {
            // The wrapped dispatcher contract forbids throwing; treat
            // any escaped exception as an internal error so the
            // after-line still records the failure.
            const detail = err instanceof Error ? err.message : String(err);
            result = {
                kind: 'error',
                code: -32603,
                message: 'Internal error',
                data: { detail },
            };
        }
        const durationMs = this.now() - startedAt;

        // ---- after-line -------------------------------------------------
        const summary = summarizeResult(result);
        const afterData: Record<string, unknown> = {
            phase: 'after',
            status: summary.status,
        };
        if (summary.errorCode !== undefined) {
            afterData.error_code = summary.errorCode;
        }
        if (summary.channel !== undefined) {
            afterData.channel = summary.channel;
        }
        this.logger.log(summary.status === 'ok' ? 'info' : 'error', COMPONENT_NAME, {
            trace_id: trace.trace_id,
            span_id: trace.span_id,
            method,
            duration_ms: durationMs,
            ...afterData,
        });

        return result;
    }
}
