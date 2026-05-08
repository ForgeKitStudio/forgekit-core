/**
 * Startup wiring tests for license discovery.
 *
 *   - `loadActiveLicenses(licenseDir)` reads every `<module_id>.key` file
 *     under `licenseDir` and returns a map of module id to license record.
 *     Malformed files are skipped with a warning and never throw. Missing
 *     directories yield an empty map.
 *   - `unlockedModulesFromLicenses(records)` maps a presence of the
 *     `forgekit_rpg` record to the four RPG subsystem modules.
 *   - `resolveLicenseDir({projectRoot})` reads `<projectRoot>/project.godot`,
 *     extracts `config/name`, and composes the per-platform path. When the
 *     file is missing, the resolver falls back to the project root's
 *     directory name.
 *
 * Validates: Requirements 16.1, 17.2, 17.4, 20.4, 32.1, 32.2, 32.3, 32.6.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadActiveLicenses,
  resolveLicenseDir,
  unlockedModulesFromLicenses,
} from '../../src/licensing/startup.js';

describe('loadActiveLicenses', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgekit-startup-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty map when the directory does not exist', async () => {
    const records = await loadActiveLicenses(join(dir, 'does-not-exist'));
    expect(records).toEqual({});
  });

  it('returns an empty map for an empty directory', async () => {
    const records = await loadActiveLicenses(dir);
    expect(records).toEqual({});
  });

  it('parses a single valid <module_id>.key file', async () => {
    const record = {
      license_id: 'forgekit_rpg',
      activated_at: '2025-01-02T03:04:05',
      fingerprint: 'a'.repeat(64),
    };
    await writeFile(join(dir, 'forgekit_rpg.key'), JSON.stringify(record), 'utf8');
    const records = await loadActiveLicenses(dir);
    expect(records).toEqual({ forgekit_rpg: record });
  });

  it('parses multiple license files keyed by their filename stem', async () => {
    const rpg = {
      license_id: 'forgekit_rpg',
      activated_at: '2025-01-02T03:04:05',
      fingerprint: 'a'.repeat(64),
    };
    const survivors = {
      license_id: 'forgekit_survivors',
      activated_at: '2025-02-03T04:05:06',
      fingerprint: 'b'.repeat(64),
    };
    await writeFile(join(dir, 'forgekit_rpg.key'), JSON.stringify(rpg), 'utf8');
    await writeFile(
      join(dir, 'forgekit_survivors.key'),
      JSON.stringify(survivors),
      'utf8',
    );
    const records = await loadActiveLicenses(dir);
    expect(records).toEqual({
      forgekit_rpg: rpg,
      forgekit_survivors: survivors,
    });
  });

  it('skips non-.key files silently', async () => {
    const record = {
      license_id: 'forgekit_rpg',
      activated_at: '2025-01-02T03:04:05',
      fingerprint: 'a'.repeat(64),
    };
    await writeFile(join(dir, 'forgekit_rpg.key'), JSON.stringify(record), 'utf8');
    await writeFile(join(dir, 'README.txt'), 'hello', 'utf8');
    const records = await loadActiveLicenses(dir);
    expect(records).toEqual({ forgekit_rpg: record });
  });

  it('skips malformed JSON files and logs a warning', async () => {
    const record = {
      license_id: 'forgekit_rpg',
      activated_at: '2025-01-02T03:04:05',
      fingerprint: 'a'.repeat(64),
    };
    await writeFile(join(dir, 'forgekit_rpg.key'), JSON.stringify(record), 'utf8');
    await writeFile(join(dir, 'broken.key'), 'not json', 'utf8');

    const warn = vi.fn();
    const records = await loadActiveLicenses(dir, { logger: { warn } });

    expect(records).toEqual({ forgekit_rpg: record });
    expect(warn).toHaveBeenCalledTimes(1);
    const [msg] = warn.mock.calls[0];
    expect(String(msg)).toContain('broken.key');
  });

  it('skips files whose contents are not an object with required fields', async () => {
    await writeFile(join(dir, 'partial.key'), JSON.stringify({ license_id: 'x' }), 'utf8');
    await writeFile(join(dir, 'arr.key'), JSON.stringify(['nope']), 'utf8');
    const records = await loadActiveLicenses(dir);
    expect(records).toEqual({});
  });
});

describe('unlockedModulesFromLicenses', () => {
  it('returns an empty set when no records are present', () => {
    const set = unlockedModulesFromLicenses({});
    expect([...set].sort()).toEqual([]);
  });

  it('unlocks the four RPG subsystems when a forgekit_rpg record is present', () => {
    const set = unlockedModulesFromLicenses({
      forgekit_rpg: {
        license_id: 'forgekit_rpg',
        activated_at: '2025-01-02T03:04:05',
        fingerprint: 'a'.repeat(64),
      },
    });
    expect([...set].sort()).toEqual(['combat', 'crafting', 'inventory', 'stats']);
  });

  it('ignores unknown module ids', () => {
    const set = unlockedModulesFromLicenses({
      forgekit_unknown: {
        license_id: 'forgekit_unknown',
        activated_at: '2025-01-02T03:04:05',
        fingerprint: 'a'.repeat(64),
      },
    });
    expect([...set].sort()).toEqual([]);
  });
});

describe('resolveLicenseDir', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'forgekit-project-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('honours an explicit licenseDir override and skips all other lookup', async () => {
    const override = join(projectRoot, 'custom', 'licenses');
    const dir = await resolveLicenseDir({
      projectRoot,
      licenseDir: override,
      platform: 'linux',
      env: {},
      homedir: '/home/x',
    });
    expect(dir).toBe(override);
  });

  it('reads project.godot for the project name and builds a Linux path', async () => {
    await writeFile(
      join(projectRoot, 'project.godot'),
      [
        '; header',
        'config_version=5',
        '',
        '[application]',
        'config/name="ForgeKit Core Template"',
      ].join('\n'),
      'utf8',
    );
    const dir = await resolveLicenseDir({
      projectRoot,
      platform: 'linux',
      env: {},
      homedir: '/home/bob',
    });
    expect(dir).toBe(
      '/home/bob/.local/share/godot/app_userdata/ForgeKit Core Template/licenses',
    );
  });

  it('falls back to the project root directory name when project.godot is missing', async () => {
    const dir = await resolveLicenseDir({
      projectRoot,
      platform: 'linux',
      env: {},
      homedir: '/home/bob',
    });
    const fallbackName = projectRoot.split('/').filter(Boolean).pop() ?? '';
    expect(dir).toBe(
      `/home/bob/.local/share/godot/app_userdata/${fallbackName}/licenses`,
    );
  });

  it('falls back to the project root directory name when config/name is absent', async () => {
    await writeFile(
      join(projectRoot, 'project.godot'),
      '[application]\nconfig/description="no name"\n',
      'utf8',
    );
    const dir = await resolveLicenseDir({
      projectRoot,
      platform: 'linux',
      env: {},
      homedir: '/home/bob',
    });
    const fallbackName = projectRoot.split('/').filter(Boolean).pop() ?? '';
    expect(dir).toBe(
      `/home/bob/.local/share/godot/app_userdata/${fallbackName}/licenses`,
    );
  });
});
