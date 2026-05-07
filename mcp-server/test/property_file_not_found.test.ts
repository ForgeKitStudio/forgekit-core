/**
 * Feature: forgekit, Property 10: FILE_NOT_FOUND contains the requested path
 *
 * Property-based test for the MCP JSON-RPC forwarding contract around
 * the `-32001 FILE_NOT_FOUND` error code. The editor plugin emits
 * `FILE_NOT_FOUND` envelopes when any tool receives a `res://` path
 * that does not exist in the project; the MCP stdio bridge hoists the
 * envelope into a JSON-RPC error response and forwards it back to the
 * client unchanged.
 *
 * Envelope shape (see `mcp_error_codes.gd` and
 * `json_rpc_dispatcher.gd` on the Godot side):
 *
 *   error: {
 *     code:    -32001,
 *     message: "FILE_NOT_FOUND",
 *     data:    { requested_path: <path>, suggestion: <text>, ... }
 *   }
 *
 * The property: for every generated non-existent path `p` fed into any
 * path-accepting MCP tool (`scene.open`, `scene.save_as`,
 * `resource.load`, ...), the JSON-RPC response returned by the stdio
 * bridge to the client carries `error.code === -32001` and
 * `error.data.requested_path === p` — i.e. the editor plugin's
 * `requested_path` field survives the end-to-end hop through the
 * bridge without mangling.
 *
 * The test stands up a real `createStdioBridge` with PassThrough
 * streams and a `ChannelDispatcher` that behaves like the editor
 * plugin for missing paths: it inspects the incoming `params`,
 * extracts the caller's path argument, and returns a `FILE_NOT_FOUND`
 * error result keyed on that path. No network or disk is touched.
 */

import fc from 'fast-check';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  createStdioBridge,
  encodeMessage,
  parseFramedBuffer,
  type ChannelDispatcher,
  type DispatchResult,
} from '../src/stdio_bridge.js';

// --------------------------------------------------------------------------
// Shared constants
// --------------------------------------------------------------------------

/** Pinned iteration count for this property. */
const NUM_RUNS = 100 as const;

/**
 * JSON-RPC error code for `FILE_NOT_FOUND`. Mirrors
 * `McpErrorCodes.FILE_NOT_FOUND` in
 * `addons/forgekit_core/mcp/editor_plugin/mcp_error_codes.gd`.
 */
const FILE_NOT_FOUND_CODE = -32001 as const;

/** Human-readable message paired with `FILE_NOT_FOUND`. */
const FILE_NOT_FOUND_MESSAGE = 'FILE_NOT_FOUND' as const;

/**
 * MCP tools that accept a `res://` path and must surface
 * `FILE_NOT_FOUND` when the path does not exist. Each tuple pairs a
 * method name with the field in `params` that carries the caller's
 * path. These match the method surface declared in design §5.1.
 */
const PATH_TOOLS: ReadonlyArray<readonly [method: string, pathField: string]> = [
  ['scene.open', 'scene_path'],
  ['scene.save', 'scene_path'],
  ['scene.save_as', 'scene_path'],
  ['scene.close', 'scene_path'],
  ['resource.load', 'path'],
  ['resource.inspect', 'path'],
  ['script.load', 'path'],
];

// --------------------------------------------------------------------------
// Test harness — real stdio bridge, simulated editor channel
// --------------------------------------------------------------------------

interface Harness {
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly stdoutChunks: Buffer[];
  readonly stop: () => void;
}

/**
 * Build a `ChannelDispatcher` that models the editor plugin's
 * `FILE_NOT_FOUND` contract: when any of `PATH_TOOLS` is invoked with
 * a path argument, the dispatcher returns a JSON-RPC error carrying
 * the caller's path in `data.requested_path`. This is the
 * contract the real editor plugin implements in GDScript — the
 * stdio bridge is the system under test.
 */
function makeFileNotFoundDispatcher(): ChannelDispatcher {
  const pathFieldByMethod = new Map<string, string>(PATH_TOOLS);
  return {
    async dispatch(method: string, params: unknown): Promise<DispatchResult> {
      const field = pathFieldByMethod.get(method);
      const record = (params ?? {}) as Record<string, unknown>;
      const requested = field !== undefined ? record[field] : undefined;
      if (typeof requested !== 'string') {
        return {
          kind: 'error',
          code: -32602,
          message: 'Invalid params',
          data: { suggestion: `missing '${field ?? '<path>'}' field` },
        };
      }
      return {
        kind: 'error',
        code: FILE_NOT_FOUND_CODE,
        message: FILE_NOT_FOUND_MESSAGE,
        data: {
          requested_path: requested,
          suggestion:
            "Verify the 'res://' path exists in the project and that the file has been saved.",
        },
      };
    },
  };
}

function startBridge(dispatcher: ChannelDispatcher): Harness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));

  const bridge = createStdioBridge({ dispatcher, stdin, stdout, stderr });
  bridge.start();

  return {
    stdin,
    stdout,
    stderr,
    stdoutChunks,
    stop: (): void => bridge.stop(),
  };
}

/**
 * Round-trip a single JSON-RPC request through the bridge and return
 * the response body. Waits until exactly one framed message appears on
 * stdout, with a short timeout.
 */
async function roundTrip(
  harness: Harness,
  request: { readonly id: number; readonly method: string; readonly params: unknown },
  timeoutMs = 500,
): Promise<Record<string, unknown>> {
  harness.stdin.write(
    encodeMessage({
      jsonrpc: '2.0',
      id: request.id,
      method: request.method,
      params: request.params,
    }),
  );

  const deadline = Date.now() + timeoutMs;
  // Poll until a complete frame appears; the bridge is async, so spin
  // briefly rather than relying on stream timings.
  while (Date.now() < deadline) {
    const buf = Buffer.concat(harness.stdoutChunks);
    const { messages } = parseFramedBuffer(buf);
    if (messages.length >= 1) {
      return messages[0] as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `Timed out waiting for a response to ${request.method} (id=${request.id}).`,
  );
}

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

/**
 * Web-style path, suitable as a stand-in for the caller's `res://`
 * path. `fc.webPath()` yields shapes like "", "/t", "/a/b/" — a broad
 * sweep across URL-safe segments that the bridge must forward
 * verbatim through `data.requested_path`.
 */
const webPathArb = fc.webPath();

/**
 * One of the `PATH_TOOLS` entries — chosen at random per iteration so
 * the property covers every tool in the set.
 */
const toolArb = fc.constantFrom(...PATH_TOOLS);

/** Monotonic JSON-RPC ids so responses can be matched to requests. */
const idArb = fc.integer({ min: 1, max: 1_000_000 });

// --------------------------------------------------------------------------
// Property
// --------------------------------------------------------------------------

describe('Property 10: FILE_NOT_FOUND contains the requested path', () => {
  it('forwards error.code === -32001 and data.requested_path === <requested path> for every generated web path', async () => {
    await fc.assert(
      fc.asyncProperty(webPathArb, toolArb, idArb, async (path, tool, id) => {
        const [method, field] = tool;
        const dispatcher = makeFileNotFoundDispatcher();
        const harness = startBridge(dispatcher);
        try {
          const response = await roundTrip(harness, {
            id,
            method,
            params: { [field]: path },
          });

          expect(response.jsonrpc).toBe('2.0');
          expect(response.id).toBe(id);

          const err = response.error as
            | {
                code: number;
                message: string;
                data?: { requested_path?: unknown };
              }
            | undefined;
          expect(err).toBeDefined();
          expect(err!.code).toBe(FILE_NOT_FOUND_CODE);
          expect(err!.message).toBe(FILE_NOT_FOUND_MESSAGE);
          expect(err!.data).toBeDefined();
          expect(err!.data!.requested_path).toBe(path);
        } finally {
          harness.stop();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
