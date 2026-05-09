/**
 * Implementation of the `android.list_devices` MCP tool.
 *
 * Runs `adb devices -l` and parses the tabular output into a list of
 * `{serial, state, model}` entries. The first line ("List of devices
 * attached") and blank lines are skipped; lines without a state column are
 * skipped as well.
 */

import { defaultSpawnAdb, type SpawnAdb } from './spawn_adb.js';

export interface AndroidDevice {
  serial: string;
  state: string;
  model: string;
}

export interface ListDevicesParams {
  // No parameters. Included for uniformity with the tool dispatcher.
}

export interface ListDevicesResult {
  devices: AndroidDevice[];
}

export interface ListDevicesDeps {
  spawn?: SpawnAdb;
}

export async function listDevices(
  _params: ListDevicesParams,
  deps: ListDevicesDeps = {},
): Promise<ListDevicesResult> {
  const spawn = deps.spawn ?? defaultSpawnAdb;
  const { stdout } = await spawn(['devices', '-l']);
  return { devices: parseAdbDevicesOutput(stdout) };
}

export function parseAdbDevicesOutput(stdout: string): AndroidDevice[] {
  const devices: AndroidDevice[] = [];
  const lines = stdout.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('List of devices attached')) continue;

    // Format examples:
    //   emulator-5554          device product:sdk_phone model:Pixel_7 device:emu
    //   RZ8NA0XXXX             unauthorized usb:1-1 product:a52sxq model:SM_A528B
    //   abc123                 device
    const tokens = line.split(/\s+/);
    if (tokens.length < 2) continue;
    const serial = tokens[0];
    const state = tokens[1];

    let model = '';
    for (let i = 2; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.startsWith('model:')) {
        model = tok.slice('model:'.length);
        break;
      }
    }

    devices.push({ serial, state, model });
  }
  return devices;
}
