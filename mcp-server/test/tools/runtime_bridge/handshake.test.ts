/**
 * Tests for the runtime-channel handshake helper.
 *
 * The helper reads `mcp_update_check.json` (written by the editor
 * plugin's periodic update checker) and returns the cached
 * `latest_version` so the UDP runtime bridge can include it in the
 * `runtime.handshake` response under the `server.latest_version`
 * field. When no newer version has been observed the helper returns
 * `null`.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readLatestVersionFromCache } from '../../../src/tools/runtime_bridge/handshake.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'forgekit-handshake-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('readLatestVersionFromCache', () => {
  it('returns null when the cache file does not exist', async () => {
    const result = await readLatestVersionFromCache(join(tmpDir, 'missing.json'));
    expect(result).toBeNull();
  });

  it('returns null when the cache file is malformed JSON', async () => {
    const path = join(tmpDir, 'bad.json');
    await writeFile(path, '{not json', 'utf8');
    const result = await readLatestVersionFromCache(path);
    expect(result).toBeNull();
  });

  it('returns null when the cached result does not advertise an update', async () => {
    const path = join(tmpDir, 'no-update.json');
    await writeFile(
      path,
      JSON.stringify({
        last_unix_seconds: 0,
        last_result: {
          ok: true,
          checked: true,
          update_available: false,
          latest_version: '0.7.0',
          current_version: '0.7.0',
        },
      }),
      'utf8',
    );
    const result = await readLatestVersionFromCache(path);
    expect(result).toBeNull();
  });

  it('returns the latest_version string when the cache reports an update', async () => {
    const path = join(tmpDir, 'update.json');
    await writeFile(
      path,
      JSON.stringify({
        last_unix_seconds: 0,
        last_result: {
          ok: true,
          checked: true,
          update_available: true,
          latest_version: '0.8.0',
          current_version: '0.7.0',
        },
      }),
      'utf8',
    );
    const result = await readLatestVersionFromCache(path);
    expect(result).toBe('0.8.0');
  });
});
