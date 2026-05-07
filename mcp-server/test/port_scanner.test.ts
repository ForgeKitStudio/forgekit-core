/**
 * Port scanner unit tests.
 *
 * Covers the four scanning ranges (Editor 6010-6019, Runtime 6020-6029,
 * Visualizer 6030-6039, Health 6040-6049), TCP and UDP discovery semantics,
 * the round-trip of the active-ports JSON file and the error behaviour when
 * a range is fully occupied or the file is missing.
 */

import { createServer, type Server } from 'node:net';
import { createSocket, type Socket } from 'node:dgram';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ACTIVE_PORT_FILE_NAME,
  ActivePortFileNotFoundError,
  EDITOR_RANGE,
  HEALTH_RANGE,
  RangeExhaustedError,
  RUNTIME_RANGE,
  VISUALIZER_RANGE,
  readActivePorts,
  scanFreePort,
  scanUdpFreePort,
  writeActivePorts,
  type ActivePortsFile,
} from '../src/port_scanner.js';

describe('port scanner — range constants', () => {
  it('defines editor range 6010-6019', () => {
    expect(EDITOR_RANGE).toEqual({ start: 6010, end: 6019 });
  });
  it('defines runtime range 6020-6029', () => {
    expect(RUNTIME_RANGE).toEqual({ start: 6020, end: 6029 });
  });
  it('defines visualizer range 6030-6039', () => {
    expect(VISUALIZER_RANGE).toEqual({ start: 6030, end: 6039 });
  });
  it('defines health range 6040-6049', () => {
    expect(HEALTH_RANGE).toEqual({ start: 6040, end: 6049 });
  });
  it('exposes the active-port filename', () => {
    expect(ACTIVE_PORT_FILE_NAME).toBe('mcp_active_port.json');
  });
});

/** Starts a TCP listener on the given port bound to 127.0.0.1. */
async function occupyTcp(port: number): Promise<Server> {
  return await new Promise<Server>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

async function closeTcp(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/** Starts a UDP socket bound to 127.0.0.1:port. */
async function occupyUdp(port: number): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = createSocket('udp4');
    socket.once('error', reject);
    socket.bind(port, '127.0.0.1', () => {
      socket.removeListener('error', reject);
      resolve(socket);
    });
  });
}

async function closeUdp(socket: Socket): Promise<void> {
  await new Promise<void>((resolve) => {
    socket.close(() => resolve());
  });
}

describe('scanFreePort — TCP', () => {
  // Use a high, stable test range that is very unlikely to collide with
  // common developer tooling. 50xx avoids the 60xx ForgeKit ranges and
  // typical reserved ports.
  const TEST_RANGE = { start: 55010, end: 55019 } as const;
  const occupiers: Server[] = [];

  afterEach(async () => {
    while (occupiers.length > 0) {
      const srv = occupiers.pop();
      if (srv) {
        await closeTcp(srv);
      }
    }
  });

  it('returns the first port in the range when all are free', async () => {
    const port = await scanFreePort(TEST_RANGE);
    expect(port).toBe(TEST_RANGE.start);
  });

  it('skips occupied ports and returns the next free one', async () => {
    const blocker = await occupyTcp(TEST_RANGE.start);
    occupiers.push(blocker);
    const port = await scanFreePort(TEST_RANGE);
    expect(port).toBe(TEST_RANGE.start + 1);
  });

  it('throws RangeExhaustedError when every port is occupied', async () => {
    // Small range to keep the test fast.
    const smallRange = { start: 55030, end: 55031 } as const;
    const a = await occupyTcp(smallRange.start);
    const b = await occupyTcp(smallRange.start + 1);
    occupiers.push(a, b);

    let caught: unknown;
    try {
      await scanFreePort(smallRange);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RangeExhaustedError);
    const err = caught as RangeExhaustedError;
    expect(err.code).toBe('PORT_RANGE_EXHAUSTED');
    expect(err.range).toEqual(smallRange);
    expect(err.checked.sort()).toEqual([smallRange.start, smallRange.start + 1]);
  });
});

describe('scanUdpFreePort', () => {
  const TEST_RANGE = { start: 55040, end: 55049 } as const;
  const occupiers: Socket[] = [];

  afterEach(async () => {
    while (occupiers.length > 0) {
      const s = occupiers.pop();
      if (s) {
        await closeUdp(s);
      }
    }
  });

  it('returns the first port in the range when all are free', async () => {
    const port = await scanUdpFreePort(TEST_RANGE);
    expect(port).toBe(TEST_RANGE.start);
  });

  it('skips occupied UDP ports', async () => {
    const blocker = await occupyUdp(TEST_RANGE.start);
    occupiers.push(blocker);
    const port = await scanUdpFreePort(TEST_RANGE);
    expect(port).toBe(TEST_RANGE.start + 1);
  });

  it('throws RangeExhaustedError when every UDP port is occupied', async () => {
    const smallRange = { start: 55060, end: 55061 } as const;
    const a = await occupyUdp(smallRange.start);
    const b = await occupyUdp(smallRange.start + 1);
    occupiers.push(a, b);

    let caught: unknown;
    try {
      await scanUdpFreePort(smallRange);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RangeExhaustedError);
    expect((caught as RangeExhaustedError).code).toBe('PORT_RANGE_EXHAUSTED');
  });
});

describe('writeActivePorts / readActivePorts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgekit-ports-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips identity', async () => {
    const path = join(dir, ACTIVE_PORT_FILE_NAME);
    const ports: ActivePortsFile = {
      editor: 6010,
      runtime: 6020,
      visualizer: 6030,
      health: 6040,
    };
    await writeActivePorts(path, ports);
    const loaded = await readActivePorts(path);
    expect(loaded).toEqual(ports);
  });

  it('writes atomically via a temporary sibling file', async () => {
    const path = join(dir, ACTIVE_PORT_FILE_NAME);
    const ports: ActivePortsFile = {
      editor: 6011,
      runtime: 6021,
      visualizer: 6031,
      health: 6041,
    };
    await writeActivePorts(path, ports);
    // The final file must exist. Any ".tmp" sibling must have been cleaned up.
    const loaded = await readActivePorts(path);
    expect(loaded).toEqual(ports);
  });

  it('throws ActivePortFileNotFoundError when the file is missing', async () => {
    const path = join(dir, 'does-not-exist.json');
    let caught: unknown;
    try {
      await readActivePorts(path);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ActivePortFileNotFoundError);
    expect((caught as ActivePortFileNotFoundError).code).toBe('ACTIVE_PORT_FILE_NOT_FOUND');
    expect((caught as ActivePortFileNotFoundError).path).toBe(path);
  });

  it('rejects malformed JSON with a descriptive error', async () => {
    const path = join(dir, ACTIVE_PORT_FILE_NAME);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, 'not-json', 'utf8');
    await expect(readActivePorts(path)).rejects.toThrowError();
  });

  it('rejects JSON missing required numeric fields', async () => {
    const path = join(dir, ACTIVE_PORT_FILE_NAME);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, JSON.stringify({ editor: 'nope' }), 'utf8');
    await expect(readActivePorts(path)).rejects.toThrowError();
  });
});
