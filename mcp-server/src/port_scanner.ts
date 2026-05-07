/**
 * Port scanner for the MCP server transports.
 *
 * The Godot editor plugin, runtime bridge, browser visualizer and health
 * endpoint each own a ten-port range. On startup the plugin walks the
 * assigned range from low to high, binds the first free port, and writes the
 * selection into `user://mcp_active_port.json` so that the MCP server can
 * discover the actual ports chosen for the current session.
 *
 * This module is the TypeScript counterpart: TCP and UDP probes plus an
 * atomic reader/writer for the shared JSON file.
 */

import { createServer, type AddressInfo } from 'node:net';
import { createSocket } from 'node:dgram';
import {
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

/** A contiguous `[start, end]` port range. Both bounds are inclusive. */
export interface PortRange {
  readonly start: number;
  readonly end: number;
}

/** Shape of `mcp_active_port.json`. */
export interface ActivePortsFile {
  editor: number;
  runtime: number;
  visualizer: number;
  health: number;
}

export const EDITOR_RANGE: PortRange = { start: 6010, end: 6019 };
export const RUNTIME_RANGE: PortRange = { start: 6020, end: 6029 };
export const VISUALIZER_RANGE: PortRange = { start: 6030, end: 6039 };
export const HEALTH_RANGE: PortRange = { start: 6040, end: 6049 };

/** Canonical filename written to `user://` by the Godot editor plugin. */
export const ACTIVE_PORT_FILE_NAME = 'mcp_active_port.json';

/**
 * Error raised when every port in a range is occupied. Exposes the offending
 * range and the list of ports that were probed so callers can surface a
 * useful diagnostic.
 */
export class RangeExhaustedError extends Error {
  readonly code = 'PORT_RANGE_EXHAUSTED';
  readonly range: PortRange;
  readonly checked: number[];

  constructor(range: PortRange, checked: number[]) {
    super(
      `All ports in range [${range.start}, ${range.end}] are occupied. ` +
        `Checked: ${checked.join(', ')}.`,
    );
    this.name = 'RangeExhaustedError';
    this.range = { start: range.start, end: range.end };
    this.checked = [...checked];
  }
}

/** Error raised when the shared active-port file is missing. */
export class ActivePortFileNotFoundError extends Error {
  readonly code = 'ACTIVE_PORT_FILE_NOT_FOUND';
  readonly path: string;

  constructor(path: string) {
    super(`Active-port file not found: ${path}`);
    this.name = 'ActivePortFileNotFoundError';
    this.path = path;
  }
}

/** Error raised when the active-port file contains invalid JSON or shape. */
export class ActivePortFileInvalidError extends Error {
  readonly code = 'ACTIVE_PORT_FILE_INVALID';
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`Active-port file at ${path} is invalid: ${reason}`);
    this.name = 'ActivePortFileInvalidError';
    this.path = path;
  }
}

function validateRange(range: PortRange): void {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    throw new Error(
      `Port range bounds must be integers, got [${range.start}, ${range.end}].`,
    );
  }
  if (range.start > range.end) {
    throw new Error(
      `Invalid port range: start ${range.start} is greater than end ${range.end}.`,
    );
  }
}

/**
 * Probes `port` by attempting to bind a TCP listener on 127.0.0.1. Resolves
 * to `true` when the port is free, `false` when it is already in use.
 */
async function isTcpPortFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    let settled = false;
    const done = (free: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      server.close(() => resolve(free));
    };
    server.once('error', () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(false);
    });
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      if (addr === null || addr.port !== port) {
        done(false);
        return;
      }
      done(true);
    });
  });
}

/**
 * Probes `port` by attempting to bind a UDP socket on 127.0.0.1. Resolves to
 * `true` when the port is free, `false` when it is already in use.
 */
async function isUdpPortFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createSocket('udp4');
    let settled = false;
    const done = (free: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.close(() => resolve(free));
    };
    socket.once('error', () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(false);
    });
    socket.bind({ port, address: '127.0.0.1', exclusive: true }, () => {
      done(true);
    });
  });
}

/**
 * Returns the first free TCP port in `range`. Throws `RangeExhaustedError`
 * when every port is occupied.
 */
export async function scanFreePort(range: PortRange): Promise<number> {
  validateRange(range);
  const checked: number[] = [];
  for (let port = range.start; port <= range.end; port++) {
    checked.push(port);
    if (await isTcpPortFree(port)) {
      return port;
    }
  }
  throw new RangeExhaustedError(range, checked);
}

/**
 * Returns the first free UDP port in `range`. Throws `RangeExhaustedError`
 * when every port is occupied.
 */
export async function scanUdpFreePort(range: PortRange): Promise<number> {
  validateRange(range);
  const checked: number[] = [];
  for (let port = range.start; port <= range.end; port++) {
    checked.push(port);
    if (await isUdpPortFree(port)) {
      return port;
    }
  }
  throw new RangeExhaustedError(range, checked);
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535;
}

/** Reads and validates `mcp_active_port.json`. */
export async function readActivePorts(path: string): Promise<ActivePortsFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ActivePortFileNotFoundError(path);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ActivePortFileInvalidError(path, `not valid JSON (${reason})`);
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new ActivePortFileInvalidError(path, 'expected a JSON object.');
  }

  const record = parsed as Record<string, unknown>;
  for (const key of ['editor', 'runtime', 'visualizer', 'health'] as const) {
    if (!isValidPort(record[key])) {
      throw new ActivePortFileInvalidError(
        path,
        `missing or non-integer field "${key}".`,
      );
    }
  }

  return {
    editor: record.editor as number,
    runtime: record.runtime as number,
    visualizer: record.visualizer as number,
    health: record.health as number,
  };
}

/**
 * Writes `ports` to `path` atomically by staging into a sibling `.tmp` file
 * and renaming it over the target once the contents are flushed.
 */
export async function writeActivePorts(
  path: string,
  ports: ActivePortsFile,
): Promise<void> {
  for (const key of ['editor', 'runtime', 'visualizer', 'health'] as const) {
    if (!isValidPort(ports[key])) {
      throw new Error(`Invalid port for "${key}": ${String(ports[key])}.`);
    }
  }
  const suffix = randomBytes(4).toString('hex');
  const tempPath = `${path}.${suffix}.tmp`;
  const payload = JSON.stringify(ports, null, 2) + '\n';
  try {
    await writeFile(tempPath, payload, { encoding: 'utf8' });
    await rename(tempPath, path);
  } catch (err) {
    // Best-effort cleanup of the staging file so it does not leak.
    try {
      await unlink(tempPath);
    } catch {
      // ignore
    }
    throw err;
  }
}
