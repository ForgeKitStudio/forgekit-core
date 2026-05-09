/**
 * Feature: forgekit, profile tool count smoke checks.
 *
 * Validates: Requirements 19.1, 19.3, 19.4, 20.1, 20.2, 20.3, 20.4,
 * 51.4, 57.2, 67.10, 67.11
 *
 * The in-repo `profiles.json` is the source of truth for the tool
 * surface exposed to MCP clients. This test loads it end-to-end and
 * asserts the four profile filters (Full / Lite / Minimal / RPG-only)
 * return tool counts that honour the spec's thresholds and that every
 * RPG subsystem (combat, crafting, inventory, stats, effects, magic,
 * equipment, progression, enemies, loot, spawner, chests, npc,
 * dialog, vendor) is unlocked when a valid `forgekit_rpg` license is
 * presented.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyProfile, loadProfiles, type ToolModule } from '../src/profiles.js';

const here = dirname(fileURLToPath(import.meta.url));
const PROFILES_PATH = resolve(here, '..', 'profiles.json');

const RPG_SUBSYSTEM_MODULES: ReadonlyArray<ToolModule> = [
  'combat',
  'crafting',
  'inventory',
  'stats',
  'effects',
  'magic',
  'equipment',
  'progression',
  'enemies',
  'loot',
  'spawner',
  'chests',
  'npc',
  'dialog',
  'vendor',
];

describe('profiles.json — tool count thresholds', () => {
  it('exposes at least 215 tools in the Full profile (Req 19.3, 67.11)', async () => {
    const profiles = await loadProfiles(PROFILES_PATH);
    const full = applyProfile(profiles, 'Full');
    expect(full.length).toBeGreaterThanOrEqual(215);
  });

  it('keeps the Minimal profile below 40 tools (Req 20.2)', async () => {
    const profiles = await loadProfiles(PROFILES_PATH);
    const minimal = applyProfile(profiles, 'Minimal');
    expect(minimal.length).toBeLessThanOrEqual(40);
    expect(minimal.length).toBeGreaterThan(0);
  });

  it('populates every tool entry with scope, channel, module (Req 19.4)', async () => {
    const profiles = await loadProfiles(PROFILES_PATH);
    for (const t of profiles.tools) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(['core', 'module']).toContain(t.scope);
      expect(['editor', 'runtime', 'cli', 'cross']).toContain(t.channel);
      expect(t.module).toBeTruthy();
    }
  });

  it('Lite exposes only scope=core tools (Req 20.3)', async () => {
    const profiles = await loadProfiles(PROFILES_PATH);
    const lite = applyProfile(profiles, 'Lite');
    for (const t of lite) {
      expect(t.scope).toBe('core');
    }
  });

  it('RPG-only with no license returns only core-minimal tools (Req 20.4)', async () => {
    const profiles = await loadProfiles(PROFILES_PATH);
    const rpgNoLicense = applyProfile(profiles, 'RPG-only');
    const minimal = applyProfile(profiles, 'Minimal');
    expect(rpgNoLicense.length).toBe(minimal.length);
    for (const t of rpgNoLicense) {
      expect(t.module).toBe('core-minimal');
    }
  });

  it('RPG-only with forgekit_rpg license unlocks every RPG subsystem (Req 20.4, 51.4, 57.2, 67.10)', async () => {
    const profiles = await loadProfiles(PROFILES_PATH);
    const rpg = applyProfile(profiles, 'RPG-only', { licenseId: 'forgekit_rpg' });
    const modulesSeen = new Set(rpg.map((t) => t.module));
    // Every RPG subsystem module must appear at least once.
    for (const mod of RPG_SUBSYSTEM_MODULES) {
      expect(modulesSeen.has(mod)).toBe(true);
    }
    // And core-minimal still ships so agents can bootstrap a project.
    expect(modulesSeen.has('core-minimal')).toBe(true);
  });
});
