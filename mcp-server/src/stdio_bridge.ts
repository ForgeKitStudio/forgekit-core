/**
 * Stdio bridge for `@forgekit/core-mcp`.
 *
 * Accepts JSON-RPC 2.0 requests on stdin using LSP-style `Content-Length`
 * framing, forwards each request to a pluggable `ChannelDispatcher`, and
 * writes the response back on stdout with the same framing. Diagnostic
 * logging is sent to stderr so stdout stays a clean JSON-RPC byte stream.
 *
 * The bridge keeps running across dispatcher errors and malformed input:
 * channel-unavailability and parse failures are reported as JSON-RPC errors
 * rather than terminating the process.
 */

import type { Readable, Writable } from 'node:stream';

/** A JSON-RPC 2.0 request as received on stdin. */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

/** Successful dispatch result — the `result` field of the response. */
export interface DispatchOk {
  readonly kind: 'ok';
  readonly result: unknown;
}

/** The underlying editor (WebSocket) or runtime (UDP) channel is down. */
export interface DispatchChannelUnavailable {
  readonly kind: 'channel-unavailable';
  readonly channel: 'editor' | 'runtime';
}

/** A structured JSON-RPC error returned by the dispatcher. */
export interface DispatchError {
  readonly kind: 'error';
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export type DispatchResult =
  | DispatchOk
  | DispatchChannelUnavailable
  | DispatchError;

/**
 * Pluggable dispatcher that routes JSON-RPC methods to the underlying
 * editor / runtime transports. Implementations must never throw; errors
 * must be surfaced as `DispatchError`.
 */
export interface ChannelDispatcher {
  dispatch(method: string, params: unknown): Promise<DispatchResult>;
}

export interface StdioBridgeOptions {
  dispatcher: ChannelDispatcher;
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
}

export interface StdioBridge {
  start(): void;
  stop(): void;
}

/**
 * Encodes an arbitrary JSON-serialisable value as an LSP-framed payload
 * ready to be written to a stream.
 */
export function encodeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  return Buffer.concat([header, body]);
}

/**
 * Parses as many complete frames as possible out of `buf`. Returns the
 * parsed JSON messages and the number of bytes consumed from the head of
 * the buffer; any trailing partial frame is left for the next call.
 *
 * Frames with an unparseable body are surfaced as a special
 * `{ __parseError: true, raw }` record so the caller can translate them
 * into a JSON-RPC -32700 response without dropping the framing pointer.
 */
export interface ParseFramedResult {
  messages: unknown[];
  consumed: number;
}

interface InternalParseResult extends ParseFramedResult {
  parseErrors: Array<{ index: number; raw: string }>;
}

export function parseFramedBuffer(buf: Buffer): ParseFramedResult {
  const { messages, consumed } = parseFramedBufferInternal(buf);
  return { messages, consumed };
}

function parseFramedBufferInternal(buf: Buffer): InternalParseResult {
  const messages: unknown[] = [];
  const parseErrors: Array<{ index: number; raw: string }> = [];
  let offset = 0;

  while (offset < buf.length) {
    const headerEnd = buf.indexOf('\r\n\r\n', offset);
    if (headerEnd === -1) {
      break;
    }
    const headerText = buf.toString('utf8', offset, headerEnd);
    const length = extractContentLength(headerText);
    if (length === null) {
      // Malformed header — discard up to the separator so we do not loop.
      offset = headerEnd + 4;
      continue;
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (bodyEnd > buf.length) {
      break;
    }
    const raw = buf.toString('utf8', bodyStart, bodyEnd);
    try {
      messages.push(JSON.parse(raw));
    } catch {
      parseErrors.push({ index: messages.length, raw });
      // Insert a sentinel so the caller can keep indices aligned if needed.
      messages.push({ __forgekitParseError: true, raw });
    }
    offset = bodyEnd;
  }

  return { messages, consumed: offset, parseErrors };
}

function extractContentLength(headerText: string): number | null {
  for (const line of headerText.split('\r\n')) {
    const match = /^Content-Length:\s*(\d+)\s*$/i.exec(line);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return null;
}

interface InboundMessage {
  value: unknown;
  parseError: { raw: string } | null;
}

function splitInbound(buf: Buffer): { inbound: InboundMessage[]; consumed: number } {
  const inbound: InboundMessage[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const headerEnd = buf.indexOf('\r\n\r\n', offset);
    if (headerEnd === -1) {
      break;
    }
    const headerText = buf.toString('utf8', offset, headerEnd);
    const length = extractContentLength(headerText);
    if (length === null) {
      offset = headerEnd + 4;
      continue;
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (bodyEnd > buf.length) {
      break;
    }
    const raw = buf.toString('utf8', bodyStart, bodyEnd);
    try {
      inbound.push({ value: JSON.parse(raw), parseError: null });
    } catch {
      inbound.push({ value: null, parseError: { raw } });
    }
    offset = bodyEnd;
  }
  return { inbound, consumed: offset };
}

function writeStderr(stderr: Writable, message: string): void {
  stderr.write(`${message}\n`);
}

function channelUnavailableMessage(channel: 'editor' | 'runtime'): string {
  return channel === 'editor'
    ? 'editor_channel_unavailable'
    : 'runtime_channel_unavailable';
}

function sanitizeId(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  return null;
}

/**
 * Creates a stdio bridge. Call `start()` to begin reading from stdin and
 * `stop()` to detach listeners; the caller owns the lifecycle of the
 * underlying streams.
 */
export function createStdioBridge(options: StdioBridgeOptions): StdioBridge {
  const dispatcher = options.dispatcher;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  let buffer = Buffer.alloc(0);
  let started = false;
  let stopped = false;

  const writeResponse = (value: unknown): void => {
    if (stopped) {
      return;
    }
    stdout.write(encodeMessage(value));
  };

  const handleInbound = async (message: InboundMessage): Promise<void> => {
    if (message.parseError !== null) {
      writeStderr(stderr, `[stdio-bridge] parse error for body: ${message.parseError.raw}`);
      writeResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      return;
    }

    const raw = message.value as Partial<JsonRpcRequest> | null;
    if (raw === null || typeof raw !== 'object') {
      writeResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
      });
      return;
    }
    const id = sanitizeId(raw.id);
    if (typeof raw.method !== 'string' || raw.method.length === 0) {
      writeResponse({
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request' },
      });
      return;
    }

    let result: DispatchResult;
    try {
      result = await dispatcher.dispatch(raw.method, raw.params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeStderr(stderr, `[stdio-bridge] dispatcher threw: ${msg}`);
      writeResponse({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'Internal error', data: { detail: msg } },
      });
      return;
    }

    switch (result.kind) {
      case 'ok':
        writeResponse({ jsonrpc: '2.0', id, result: result.result });
        return;
      case 'channel-unavailable':
        writeResponse({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: channelUnavailableMessage(result.channel),
          },
        });
        return;
      case 'error':
        writeResponse({
          jsonrpc: '2.0',
          id,
          error: {
            code: result.code,
            message: result.message,
            ...(result.data === undefined ? {} : { data: result.data }),
          },
        });
        return;
      default: {
        const never: never = result;
        writeStderr(stderr, `[stdio-bridge] unexpected dispatch result: ${String(never)}`);
      }
    }
  };

  const processQueue: Array<InboundMessage> = [];
  let draining = false;

  const drain = async (): Promise<void> => {
    if (draining) {
      return;
    }
    draining = true;
    try {
      while (processQueue.length > 0) {
        const next = processQueue.shift() as InboundMessage;
        await handleInbound(next);
      }
    } finally {
      draining = false;
    }
  };

  const onData = (chunk: Buffer): void => {
    buffer = Buffer.concat([buffer, chunk]);
    const { inbound, consumed } = splitInbound(buffer);
    buffer = buffer.subarray(consumed);
    for (const entry of inbound) {
      processQueue.push(entry);
    }
    if (inbound.length > 0) {
      void drain();
    }
  };

  const onError = (err: Error): void => {
    writeStderr(stderr, `[stdio-bridge] stdin error: ${err.message}`);
  };

  return {
    start(): void {
      if (started) {
        return;
      }
      started = true;
      stdin.on('data', onData);
      stdin.on('error', onError);
    },
    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      stdin.off('data', onData);
      stdin.off('error', onError);
    },
  };
}
