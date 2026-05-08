/**
 * Pure path-resolution tests for `resolveUserLicenseDir` and
 * `parseProjectName`. These helpers mirror Godot's `user://licenses/`
 * convention on each platform without performing any I/O, so they are
 * fully driven by injected `platform`, `env`, `homedir`, and `projectName`
 * inputs.
 *
 * Validates: Requirements 32.1, 32.6.
 */

import { describe, expect, it } from 'vitest';

import {
  parseProjectName,
  resolveUserLicenseDir,
} from '../../src/licensing/license_directory.js';

describe('resolveUserLicenseDir', () => {
  it('builds the macOS path under Library/Application Support/Godot', () => {
    const dir = resolveUserLicenseDir({
      platform: 'darwin',
      env: {},
      homedir: '/Users/alice',
      projectName: 'forgekit_core_template',
    });
    expect(dir).toBe(
      '/Users/alice/Library/Application Support/Godot/app_userdata/forgekit_core_template/licenses',
    );
  });

  it('builds the Linux path under ~/.local/share/godot', () => {
    const dir = resolveUserLicenseDir({
      platform: 'linux',
      env: {},
      homedir: '/home/bob',
      projectName: 'forgekit_core_template',
    });
    expect(dir).toBe(
      '/home/bob/.local/share/godot/app_userdata/forgekit_core_template/licenses',
    );
  });

  it('builds the Windows path under %APPDATA%/Godot', () => {
    const dir = resolveUserLicenseDir({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\Carol\\AppData\\Roaming' },
      homedir: 'C:\\Users\\Carol',
      projectName: 'forgekit_core_template',
    });
    expect(dir).toBe(
      'C:\\Users\\Carol\\AppData\\Roaming\\Godot\\app_userdata\\forgekit_core_template\\licenses',
    );
  });

  it('falls back to <homedir>/AppData/Roaming on Windows when APPDATA is missing', () => {
    const dir = resolveUserLicenseDir({
      platform: 'win32',
      env: {},
      homedir: 'C:\\Users\\Carol',
      projectName: 'forgekit_core_template',
    });
    expect(dir).toBe(
      'C:\\Users\\Carol\\AppData\\Roaming\\Godot\\app_userdata\\forgekit_core_template\\licenses',
    );
  });

  it('treats unknown platforms as Linux-style', () => {
    const dir = resolveUserLicenseDir({
      platform: 'freebsd',
      env: {},
      homedir: '/home/dan',
      projectName: 'forgekit_core_template',
    });
    expect(dir).toBe(
      '/home/dan/.local/share/godot/app_userdata/forgekit_core_template/licenses',
    );
  });
});

describe('parseProjectName', () => {
  it('extracts a double-quoted config/name value', () => {
    const src = [
      '; Engine configuration file.',
      'config_version=5',
      '',
      '[application]',
      '',
      'config/name="ForgeKit Core Template"',
      'config/features=PackedStringArray("4.3")',
    ].join('\n');
    expect(parseProjectName(src)).toBe('ForgeKit Core Template');
  });

  it('returns null when config/name is absent', () => {
    const src = [
      '[application]',
      'config/description="no name here"',
    ].join('\n');
    expect(parseProjectName(src)).toBeNull();
  });

  it('returns null for a malformed (unquoted) config/name line', () => {
    const src = 'config/name=ForgeKitCore';
    expect(parseProjectName(src)).toBeNull();
  });

  it('is tolerant of surrounding whitespace', () => {
    const src = '   config/name = "Spaced Name"   ';
    expect(parseProjectName(src)).toBe('Spaced Name');
  });
});
