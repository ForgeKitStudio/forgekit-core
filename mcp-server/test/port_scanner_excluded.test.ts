/**
 * Tests for the Phase 7 `excluded` option on scanFreePort.
 *
 * The option lets multi-workspace callers aggregate ports already in
 * use by sibling workspaces in the same process and pass them as
 * `excluded` so the scanner skips them even when they would otherwise
 * bind successfully. When every port in the range is either bound or
 * excluded, the scanner throws a PortRangeExhaustedError carrying the
 * channel, range bounds, and the union of in-use ports.
 */

import { createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { PortRangeExhaustedError } from '../src/projects/errors.js';
import {
  RangeExhaustedError,
  scanFreePort,
} from '../src/port_scanner.js';

const TEST_RANGE = { start: 55110, end: 55119 } as const;

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

const opened: Server[] = [];

afterEach(async () => {
  while (opened.length > 0) {
    const srv = opened.pop();
    if (srv) {
      await closeTcp(srv);
    }
  }
});

describe('scanFreePort — excluded option', () => {
  it('is backwards compatible: scanFreePort(range) still picks the first free port', async () => {
    const port = await scanFreePort(TEST_RANGE);
    expect(port).toBe(TEST_RANGE.start);
  });

  it('skips ports listed in excluded even when the kernel would accept them', async () => {
    const port = await scanFreePort(TEST_RANGE, {
      excluded: [TEST_RANGE.start, TEST_RANGE.start + 1],
    });
    expect(port).toBe(TEST_RANGE.start + 2);
  });

  it('merges excluded with kernel-level occupancy', async () => {
    const blocker = await occupyTcp(TEST_RANGE.start + 2);
    opened.push(blocker);
    const port = await scanFreePort(TEST_RANGE, {
      excluded: [TEST_RANGE.start, TEST_RANGE.start + 1],
    });
    expect(port).toBe(TEST_RANGE.start + 3);
  });

  it('throws PortRangeExhaustedError with channel+range+in_use when every port is excluded', async () => {
    const smallRange = { start: 55120, end: 55122 } as const;
    const excluded = [55120, 55121, 55122] as const;
    try {
      await scanFreePort(smallRange, { excluded, channel: 'editor' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PortRangeExhaustedError);
      const e = err as PortRangeExhaustedError;
      expect(e.code).toBe(-32020);
      expect(e.data.channel).toBe('editor');
      expect(e.data.range_start).toBe(55120);
      expect(e.data.range_end).toBe(55122);
      expect(e.data.in_use.sort()).toEqual([55120, 55121, 55122]);
    }
  });

  it('falls back to the legacy RangeExhaustedError when no channel is supplied and the range is fully occupied', async () => {
    const smallRange = { start: 55130, end: 55131 } as const;
    const a = await occupyTcp(smallRange.start);
    const b = await occupyTcp(smallRange.start + 1);
    opened.push(a, b);

    try {
      await scanFreePort(smallRange);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RangeExhaustedError);
    }
  });

  it('throws PortRangeExhaustedError when channel is supplied even without excluded', async () => {
    const smallRange = { start: 55140, end: 55140 } as const;
    const a = await occupyTcp(smallRange.start);
    opened.push(a);

    try {
      await scanFreePort(smallRange, { channel: 'runtime' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PortRangeExhaustedError);
      expect((err as PortRangeExhaustedError).data.channel).toBe('runtime');
    }
  });
});
