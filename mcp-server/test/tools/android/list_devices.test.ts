/**
 * Tests for the `android.list_devices` MCP tool.
 *
 * The tool spawns `adb devices -l` and parses the resulting table into a
 * list of `{serial, state, model}` entries. Tests inject a fake spawn so
 * they never touch the real adb binary.
 */

import { describe, expect, it } from 'vitest';

import { listDevices } from '../../../src/tools/android/list_devices.js';
import type { SpawnAdb } from '../../../src/tools/android/spawn_adb.js';

function fakeAdb(stdout: string, opts: { exitCode?: number } = {}): SpawnAdb {
  return async () => ({ stdout, stderr: '', exitCode: opts.exitCode ?? 0 });
}

const SAMPLE_STDOUT = `List of devices attached
emulator-5554          device product:sdk_phone_x86_64 model:Pixel_7 device:emu64x
RZ8NA0XXXX             unauthorized usb:1-1 product:a52sxq model:SM_A528B device:a52sxq

`;

describe('listDevices', () => {
  it('parses multiple attached devices', async () => {
    const result = await listDevices({}, { spawn: fakeAdb(SAMPLE_STDOUT) });
    expect(result.devices).toHaveLength(2);
    expect(result.devices[0].serial).toBe('emulator-5554');
    expect(result.devices[0].state).toBe('device');
    expect(result.devices[0].model).toBe('Pixel_7');
    expect(result.devices[1].serial).toBe('RZ8NA0XXXX');
    expect(result.devices[1].state).toBe('unauthorized');
    expect(result.devices[1].model).toBe('SM_A528B');
  });

  it('returns an empty array when no devices are attached', async () => {
    const empty = 'List of devices attached\n\n';
    const result = await listDevices({}, { spawn: fakeAdb(empty) });
    expect(result.devices).toEqual([]);
  });

  it('leaves model empty when the adb line carries no model field', async () => {
    const stdout = 'List of devices attached\nabc123                 device\n\n';
    const result = await listDevices({}, { spawn: fakeAdb(stdout) });
    expect(result.devices[0].model).toBe('');
  });
});
