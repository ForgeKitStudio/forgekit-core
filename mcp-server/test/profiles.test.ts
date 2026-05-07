/**
 * Profile loader / selector tests.
 *
 * Profiles filter the 215-tool MCP surface down to what a given client can
 * host. The four profiles are `Full`, `Lite`, `Minimal` and `RPG-only`. The
 * `RPG-only` profile additionally requires a valid `forgekit_rpg` license
 * before subsystem tools are exposed.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RpgLicenseRequiredError,
  UnknownProfileError,
  VALID_PROFILES,
  applyProfile,
  loadProfiles,
  type ProfilesFile,
  type ToolEntry,
} from '../src/profiles.js';

const FIXTURE: ProfilesFile = {
  version: '1.0.0',
  tools: [
    { name: 'project.info', scope: 'core', channel: 'editor', module: 'core-minimal' },
    { name: 'project.list_modules', scope: 'core', channel: 'editor', module: 'core-minimal' },
    { name: 'scene.open', scope: 'core', channel: 'editor', module: 'core-minimal' },
    { name: 'node.add', scope: 'core', channel: 'editor', module: 'core' },
    { name: 'node.set_property', scope: 'core', channel: 'editor', module: 'core' },
    { name: 'combat.list_hitboxes', scope: 'module', channel: 'runtime', module: 'combat' },
    { name: 'crafting.execute', scope: 'module', channel: 'runtime', module: 'crafting' },
    { name: 'inventory.add_item', scope: 'module', channel: 'runtime', module: 'inventory' },
    { name: 'stats.get_stat', scope: 'module', channel: 'runtime', module: 'stats' },
  ],
};

function names(tools: ToolEntry[]): string[] {
  return tools.map((t) => t.name).sort();
}

describe('VALID_PROFILES', () => {
  it('enumerates the four supported profile names', () => {
    expect([...VALID_PROFILES]).toEqual(['Full', 'Lite', 'Minimal', 'RPG-only']);
  });
});

describe('loadProfiles', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgekit-profiles-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a valid profiles.json', async () => {
    const path = join(dir, 'profiles.json');
    await writeFile(path, JSON.stringify(FIXTURE), 'utf8');
    const loaded = await loadProfiles(path);
    expect(loaded.tools).toHaveLength(FIXTURE.tools.length);
    expect(loaded.tools[0]).toMatchObject({
      name: 'project.info',
      scope: 'core',
      channel: 'editor',
      module: 'core-minimal',
    });
  });

  it('rejects non-JSON content', async () => {
    const path = join(dir, 'profiles.json');
    await writeFile(path, 'not json', 'utf8');
    await expect(loadProfiles(path)).rejects.toThrowError();
  });

  it('rejects JSON missing the tools array', async () => {
    const path = join(dir, 'profiles.json');
    await writeFile(path, JSON.stringify({ version: '1.0.0' }), 'utf8');
    await expect(loadProfiles(path)).rejects.toThrowError();
  });

  it('rejects a tool entry missing required fields', async () => {
    const path = join(dir, 'profiles.json');
    await writeFile(
      path,
      JSON.stringify({ version: '1.0.0', tools: [{ name: 'broken' }] }),
      'utf8',
    );
    await expect(loadProfiles(path)).rejects.toThrowError();
  });

  it('rejects a tool entry with an unknown scope value', async () => {
    const path = join(dir, 'profiles.json');
    const bad = {
      version: '1.0.0',
      tools: [{ name: 'x', scope: 'unknown', channel: 'editor', module: 'core' }],
    };
    await writeFile(path, JSON.stringify(bad), 'utf8');
    await expect(loadProfiles(path)).rejects.toThrowError();
  });
});

describe('applyProfile', () => {
  it('Full returns every tool', () => {
    const tools = applyProfile(FIXTURE, 'Full');
    expect(names(tools)).toEqual(names(FIXTURE.tools));
  });

  it('Minimal returns only core-minimal tools', () => {
    const tools = applyProfile(FIXTURE, 'Minimal');
    expect(names(tools)).toEqual(['project.info', 'project.list_modules', 'scene.open']);
  });

  it('Lite excludes tools whose scope is module', () => {
    const tools = applyProfile(FIXTURE, 'Lite');
    for (const t of tools) {
      expect(t.scope).toBe('core');
    }
    // Includes core and core-minimal tools.
    expect(names(tools)).toEqual([
      'node.add',
      'node.set_property',
      'project.info',
      'project.list_modules',
      'scene.open',
    ]);
  });

  it('RPG-only with a valid license returns core-minimal plus every RPG subsystem', () => {
    const tools = applyProfile(FIXTURE, 'RPG-only', { licenseId: 'forgekit_rpg' });
    expect(names(tools)).toEqual([
      'combat.list_hitboxes',
      'crafting.execute',
      'inventory.add_item',
      'project.info',
      'project.list_modules',
      'scene.open',
      'stats.get_stat',
    ]);
  });

  it('RPG-only without a license returns only core-minimal tools', () => {
    const tools = applyProfile(FIXTURE, 'RPG-only', { licenseId: null });
    expect(names(tools)).toEqual(['project.info', 'project.list_modules', 'scene.open']);
  });

  it('RPG-only with an undefined license option returns only core-minimal tools', () => {
    const tools = applyProfile(FIXTURE, 'RPG-only');
    expect(names(tools)).toEqual(['project.info', 'project.list_modules', 'scene.open']);
  });

  it('RPG-only rejects an unknown license string', () => {
    let caught: unknown;
    try {
      applyProfile(FIXTURE, 'RPG-only', { licenseId: 'wrong_license' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RpgLicenseRequiredError);
    expect((caught as RpgLicenseRequiredError).code).toBe('RPG_LICENSE_REQUIRED');
  });

  it('throws UnknownProfileError when given an unrecognised profile name', () => {
    let caught: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      applyProfile(FIXTURE, 'Bogus' as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownProfileError);
    expect((caught as UnknownProfileError).code).toBe('UNKNOWN_PROFILE');
    expect((caught as UnknownProfileError).valid).toEqual([
      'Full',
      'Lite',
      'Minimal',
      'RPG-only',
    ]);
  });
});

describe('profiles.json on disk', () => {
  it('loads from the shipped profiles.json and produces a non-empty Full profile', async () => {
    const { fileURLToPath } = await import('node:url');
    const here = fileURLToPath(new URL('.', import.meta.url));
    const path = join(here, '..', 'profiles.json');
    const data = await loadProfiles(path);
    const full = applyProfile(data, 'Full');
    expect(full.length).toBeGreaterThan(0);

    // Each of the four profiles must produce at least one tool with our fixture-
    // shaped profiles.json (skeleton population).
    expect(applyProfile(data, 'Minimal').length).toBeGreaterThan(0);
    expect(applyProfile(data, 'Lite').length).toBeGreaterThan(0);
    expect(
      applyProfile(data, 'RPG-only', { licenseId: 'forgekit_rpg' }).length,
    ).toBeGreaterThan(0);
  });
});
