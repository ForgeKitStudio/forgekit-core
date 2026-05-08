/**
 * Integration-level assertions against the real `mcp-server/profiles.json`
 * for the seven runtime-channel `inventory.*` MCP tools (task 3.14).
 *
 * These tests guard the on-disk registration so accidental edits to
 * `profiles.json` (wrong `module` tag, wrong `channel`, wrong `scope`,
 * or a missing tool name) surface immediately rather than at the first
 * `--profile RPG-only` start.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyProfile,
  loadProfiles,
  type ToolEntry,
} from '../src/profiles.js';

const REAL_PROFILES_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'profiles.json',
);

const INVENTORY_TOOL_NAMES = [
  'inventory.add_item',
  'inventory.remove_item',
  'inventory.get_count',
  'inventory.snapshot',
  'inventory.clear',
  'inventory.transfer',
  'inventory.set_capacity',
] as const;

describe('profiles.json — inventory tools (task 3.14)', () => {
  it('registers all seven inventory.* tools', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const registered = new Set(profiles.tools.map((t) => t.name));
    for (const name of INVENTORY_TOOL_NAMES) {
      expect(registered.has(name)).toBe(true);
    }
  });

  it('tags every inventory tool with module=inventory, scope=module, channel=runtime', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const inventoryTools = profiles.tools.filter((t) =>
      (INVENTORY_TOOL_NAMES as readonly string[]).includes(t.name),
    );
    expect(inventoryTools).toHaveLength(INVENTORY_TOOL_NAMES.length);
    for (const t of inventoryTools) {
      expect(t.module).toBe('inventory');
      expect(t.scope).toBe('module');
      expect(t.channel).toBe('runtime');
    }
  });

  it('Full profile exposes every inventory tool', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const full = applyProfile(profiles, 'Full');
    for (const name of INVENTORY_TOOL_NAMES) {
      expect(full.find((t: ToolEntry) => t.name === name)).toBeDefined();
    }
  });

  it('RPG-only profile exposes every inventory tool when the license is valid', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const rpg = applyProfile(profiles, 'RPG-only', { licenseId: 'forgekit_rpg' });
    for (const name of INVENTORY_TOOL_NAMES) {
      expect(rpg.find((t: ToolEntry) => t.name === name)).toBeDefined();
    }
  });

  it('RPG-only profile without a license hides every inventory tool', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const rpg = applyProfile(profiles, 'RPG-only', { licenseId: null });
    for (const name of INVENTORY_TOOL_NAMES) {
      expect(rpg.find((t: ToolEntry) => t.name === name)).toBeUndefined();
    }
  });

  it('Lite profile hides every inventory tool (scope=module)', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const lite = applyProfile(profiles, 'Lite');
    for (const name of INVENTORY_TOOL_NAMES) {
      expect(lite.find((t: ToolEntry) => t.name === name)).toBeUndefined();
    }
  });

  it('Minimal profile hides every inventory tool (module=inventory, not core-minimal)', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const minimal = applyProfile(profiles, 'Minimal');
    for (const name of INVENTORY_TOOL_NAMES) {
      expect(minimal.find((t: ToolEntry) => t.name === name)).toBeUndefined();
    }
  });
});
