/**
 * Stdio bridge tests.
 *
 * The stdio bridge accepts JSON-RPC 2.0 requests on stdin using LSP-style
 * `Content-Length` framing, forwards them through a pluggable channel
 * dispatcher, and writes responses to stdout using the same framing.
 * Diagnostics go to stderr only, never to stdout.
 */

import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  createStdioBridge,
  encodeMessage,
  parseFramedBuffer,
  type ChannelDispatcher,
  type DispatchResult,
} from '../src/stdio_bridge.js';

interface StreamHarness {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  stdoutChunks: Buffer[];
  stderrChunks: Buffer[];
}

function makeHarness(): StreamHarness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
  return { stdin, stdout, stderr, stdoutChunks, stderrChunks };
}

/** Collects framed JSON-RPC messages from an accumulated stdout buffer. */
function drainMessages(chunks: Buffer[]): unknown[] {
  const buf = Buffer.concat(chunks);
  return parseFramedBuffer(buf).messages;
}

/** Waits for exactly `count` framed messages to appear on stdout. */
async function waitForMessages(
  harness: StreamHarness,
  count: number,
  timeoutMs = 1000,
): Promise<unknown[]> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const messages = drainMessages(harness.stdoutChunks);
    if (messages.length >= count) {
      return messages;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${count} messages on stdout; saw ${messages.length}.`,
      );
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

class RecordingDispatcher implements ChannelDispatcher {
  readonly calls: Array<{ method: string; params: unknown }> = [];

  constructor(private readonly handler: (method: string, params: unknown) => DispatchResult) {}

  async dispatch(method: string, params: unknown): Promise<DispatchResult> {
    this.calls.push({ method, params });
    return this.handler(method, params);
  }
}

describe('encodeMessage / parseFramedBuffer', () => {
  it('round-trips a single JSON-RPC object', () => {
    const payload = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const framed = encodeMessage(payload);
    const { messages, consumed } = parseFramedBuffer(framed);
    expect(messages).toEqual([payload]);
    expect(consumed).toBe(framed.length);
  });

  it('parses multiple back-to-back messages', () => {
    const a = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'a' });
    const b = encodeMessage({ jsonrpc: '2.0', id: 2, method: 'b' });
    const { messages, consumed } = parseFramedBuffer(Buffer.concat([a, b]));
    expect(messages).toHaveLength(2);
    expect(consumed).toBe(a.length + b.length);
  });

  it('leaves partial trailing frames unconsumed', () => {
    const a = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'a' });
    // Declare a 50-byte body but only supply 10 bytes — the frame is
    // incomplete and must not be consumed.
    const partial = Buffer.concat([a, Buffer.from('Content-Length: 50\r\n\r\n{"jsonrpc"')]);
    const { messages, consumed } = parseFramedBuffer(partial);
    expect(messages).toEqual([{ jsonrpc: '2.0', id: 1, method: 'a' }]);
    expect(consumed).toBe(a.length);
  });
});

describe('stdio bridge — happy path', () => {
  it('forwards a valid JSON-RPC request to the dispatcher and writes the response to stdout', async () => {
    const harness = makeHarness();
    const dispatcher = new RecordingDispatcher(() => ({
      kind: 'ok',
      result: { pong: true },
    }));
    const bridge = createStdioBridge({
      dispatcher,
      stdin: harness.stdin,
      stdout: harness.stdout,
      stderr: harness.stderr,
    });
    bridge.start();

    const request = { jsonrpc: '2.0', id: 7, method: 'scene.open', params: { path: 'a.tscn' } };
    harness.stdin.write(encodeMessage(request));

    const messages = await waitForMessages(harness, 1);
    expect(messages).toEqual([
      { jsonrpc: '2.0', id: 7, result: { pong: true } },
    ]);
    expect(dispatcher.calls).toEqual([
      { method: 'scene.open', params: { path: 'a.tscn' } },
    ]);
    // Stderr must not contain anything resembling JSON-RPC payloads.
    const stderrText = Buffer.concat(harness.stderrChunks).toString('utf8');
    expect(stderrText).not.toContain('"jsonrpc"');

    bridge.stop();
  });
});

describe('stdio bridge — channel unavailable', () => {
  it('returns JSON-RPC error -32000 editor_channel_unavailable and keeps the process alive', async () => {
    const harness = makeHarness();
    const dispatcher = new RecordingDispatcher(() => ({
      kind: 'channel-unavailable',
      channel: 'editor',
    }));
    const bridge = createStdioBridge({
      dispatcher,
      stdin: harness.stdin,
      stdout: harness.stdout,
      stderr: harness.stderr,
    });
    bridge.start();

    harness.stdin.write(
      encodeMessage({ jsonrpc: '2.0', id: 1, method: 'scene.open', params: {} }),
    );

    const [message] = await waitForMessages(harness, 1);
    const body = message as {
      jsonrpc: string;
      id: number;
      error: { code: number; message: string };
    };
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toBe('editor_channel_unavailable');
    expect(body.id).toBe(1);

    // A follow-up request must still be serviced; the bridge did not exit.
    dispatcher.calls.length = 0;
    const laterDispatcher = new RecordingDispatcher(() => ({ kind: 'ok', result: 'ok' }));
    // Swap the dispatcher reference by stopping and starting a new bridge on
    // the same streams is heavy — instead send a second request through the
    // same bridge, which now receives another channel-unavailable.
    harness.stdin.write(
      encodeMessage({ jsonrpc: '2.0', id: 2, method: 'scene.save', params: {} }),
    );
    const messages = await waitForMessages(harness, 2);
    expect(messages).toHaveLength(2);

    bridge.stop();
    // Keep laterDispatcher referenced so lint does not flag it.
    expect(laterDispatcher.calls).toEqual([]);
  });

  it('returns runtime_channel_unavailable when the dispatcher reports the runtime channel', async () => {
    const harness = makeHarness();
    const dispatcher = new RecordingDispatcher(() => ({
      kind: 'channel-unavailable',
      channel: 'runtime',
    }));
    const bridge = createStdioBridge({
      dispatcher,
      stdin: harness.stdin,
      stdout: harness.stdout,
      stderr: harness.stderr,
    });
    bridge.start();

    harness.stdin.write(
      encodeMessage({ jsonrpc: '2.0', id: 9, method: 'inventory.add_item', params: {} }),
    );

    const [message] = await waitForMessages(harness, 1);
    const body = message as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toBe('runtime_channel_unavailable');

    bridge.stop();
  });
});

describe('stdio bridge — malformed JSON', () => {
  it('emits JSON-RPC parse error -32700 and keeps reading', async () => {
    const harness = makeHarness();
    const dispatcher = new RecordingDispatcher(() => ({ kind: 'ok', result: 'ok' }));
    const bridge = createStdioBridge({
      dispatcher,
      stdin: harness.stdin,
      stdout: harness.stdout,
      stderr: harness.stderr,
    });
    bridge.start();

    // Craft a framed payload whose body is invalid JSON.
    const body = '{invalid';
    const bodyBuf = Buffer.from(body, 'utf8');
    const header = Buffer.from(`Content-Length: ${bodyBuf.length}\r\n\r\n`, 'utf8');
    harness.stdin.write(Buffer.concat([header, bodyBuf]));

    // After the parse-error response, send a valid request to prove the
    // reader did not abort.
    harness.stdin.write(
      encodeMessage({ jsonrpc: '2.0', id: 42, method: 'ping', params: {} }),
    );

    const messages = await waitForMessages(harness, 2);
    const parseErr = messages[0] as {
      jsonrpc: string;
      id: number | null;
      error: { code: number; message: string };
    };
    expect(parseErr.jsonrpc).toBe('2.0');
    expect(parseErr.error.code).toBe(-32700);
    expect(parseErr.error.message.toLowerCase()).toContain('parse');
    expect(parseErr.id).toBeNull();

    const pong = messages[1] as { id: number; result: unknown };
    expect(pong.id).toBe(42);
    expect(dispatcher.calls).toEqual([{ method: 'ping', params: {} }]);

    bridge.stop();
  });
});

describe('stdio bridge — dispatcher error', () => {
  it('maps a dispatcher error result to JSON-RPC -32603 internal error', async () => {
    const harness = makeHarness();
    const dispatcher = new RecordingDispatcher(() => ({
      kind: 'error',
      code: -32603,
      message: 'internal_error',
      data: { reason: 'boom' },
    }));
    const bridge = createStdioBridge({
      dispatcher,
      stdin: harness.stdin,
      stdout: harness.stdout,
      stderr: harness.stderr,
    });
    bridge.start();

    harness.stdin.write(
      encodeMessage({ jsonrpc: '2.0', id: 3, method: 'broken', params: {} }),
    );

    const [message] = await waitForMessages(harness, 1);
    const body = message as {
      id: number;
      error: { code: number; message: string; data: unknown };
    };
    expect(body.id).toBe(3);
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toBe('internal_error');
    expect(body.error.data).toEqual({ reason: 'boom' });

    bridge.stop();
  });
});
