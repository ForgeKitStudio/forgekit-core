/**
 * Trace/span identifier helpers for the MCP server observability layer.
 *
 * Every JSON-RPC request that travels through the editor channel
 * (WebSocket) or the runtime channel (UDP) is assigned a trace id so a
 * single logical operation can be reconstructed across GDScript and
 * TypeScript log streams. Spans identify smaller sub-operations inside
 * the same trace — for example, the JSON-RPC dispatch versus the
 * downstream tool handler call.
 *
 * Shapes:
 *   - `trace_id` is an 8-char lowercase hex string (32 bits of entropy).
 *   - `span_id`  is a 4-char lowercase hex string (16 bits of entropy).
 *
 * 32 bits of trace entropy is enough for the volumes a single MCP
 * session produces. 16 bits of span entropy is enough inside one
 * trace, because only a handful of spans per trace ever coexist. Both
 * widths are chosen to keep the ids short in log lines while still
 * being unambiguous at the scale of a session.
 */

import { randomBytes } from 'node:crypto';

/** Trace context shared between the server and the GDScript clients. */
export interface TraceContext {
  trace_id: string;
  span_id: string;
}

/** Return a freshly minted 8-char lowercase hex trace id. */
export function generateTraceId(): string {
  return randomBytes(4).toString('hex');
}

/** Return a freshly minted 4-char lowercase hex span id. */
export function generateSpanId(): string {
  return randomBytes(2).toString('hex');
}

/** Build a new TraceContext with a freshly generated trace and span id. */
export function newTraceContext(): TraceContext {
  return {
    trace_id: generateTraceId(),
    span_id: generateSpanId(),
  };
}
