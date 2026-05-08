/**
 * Integration-level assertions against the real `mcp-server/profiles.json`
 * for the eight `crafting.*` MCP tools (task 3.15).
 *
 * These tests guard the on-disk registration so accidental edits to
 * `profiles.json` (wrong `module` tag, wrong `channel`, wrong `scope`,
 * or a missing tool name) surface immediately rather than at the first
 * `--profile RPG-only` start.
 *
 * Crafting tool channels per design §5.4.28:
 *
 *   crafting.execute           — runtime
 *   crafting.list_recipes      — editor/runtime (we pick `runtime` since
 *                                the same tool is served on both channels
 *                                and the editor-side surface is covered by
 *                                the runtime handler registration in the
 *                                RPG module)
 *   crafting.get_recipe        — editor/runtime → runtime
 *   crafting.create_recipe     — editor
 *   crafting.update_recipe     — editor
 *   crafting.delete_recipe     — editor
 *   crafting.validate_recipe   — editor/cli → cli
 *   crafting.simulate_cost     — runtime
 *
 * The four profiles exercised below:
 *   Full       — every crafting tool exposed.
 *   Lite       — none exposed (all have scope=module).
 *   Minimal    — none exposed (none carry module=core-minimal).
 *   RPG-only   — every crafting tool exposed when the license is valid;
 *                none exposed when the license is missing.
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

const CRAFTING_TOOL_NAMES = [
  'crafting.execute',
  'crafting.list_recipes',
  'crafting.get_recipe',
  'crafting.create_recipe',
  'crafting.update_recipe',
  'crafting.delete_recipe',
  'crafting.validate_recipe',
  'crafting.simulate_cost',
] as const;

describe('profiles.json — crafting tools (task 3.15)', () => {
  it('registers all eight crafting.* tools', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const registered = new Set(profiles.tools.map((t) => t.name));
    for (const name of CRAFTING_TOOL_NAMES) {
      expect(registered.has(name)).toBe(true);
    }
  });

  it('tags every crafting tool with module=crafting and scope=module', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const craftingTools = profiles.tools.filter((t) =>
      (CRAFTING_TOOL_NAMES as readonly string[]).includes(t.name),
    );
    expect(craftingTools).toHaveLength(CRAFTING_TOOL_NAMES.length);
    for (const t of craftingTools) {
      expect(t.module).toBe('crafting');
      expect(t.scope).toBe('module');
    }
  });

  it('Full profile exposes every crafting tool', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const full = applyProfile(profiles, 'Full');
    for (const name of CRAFTING_TOOL_NAMES) {
      expect(full.find((t: ToolEntry) => t.name === name)).toBeDefined();
    }
  });

  it('RPG-only profile exposes every crafting tool when the license is valid', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const rpg = applyProfile(profiles, 'RPG-only', { licenseId: 'forgekit_rpg' });
    for (const name of CRAFTING_TOOL_NAMES) {
      expect(rpg.find((t: ToolEntry) => t.name === name)).toBeDefined();
    }
  });

  it('RPG-only profile without a license hides every crafting tool', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const rpg = applyProfile(profiles, 'RPG-only', { licenseId: null });
    for (const name of CRAFTING_TOOL_NAMES) {
      expect(rpg.find((t: ToolEntry) => t.name === name)).toBeUndefined();
    }
  });

  it('Lite profile hides every crafting tool (scope=module)', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const lite = applyProfile(profiles, 'Lite');
    for (const name of CRAFTING_TOOL_NAMES) {
      expect(lite.find((t: ToolEntry) => t.name === name)).toBeUndefined();
    }
  });

  it('Minimal profile hides every crafting tool (module=crafting, not core-minimal)', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const minimal = applyProfile(profiles, 'Minimal');
    for (const name of CRAFTING_TOOL_NAMES) {
      expect(minimal.find((t: ToolEntry) => t.name === name)).toBeUndefined();
    }
  });

  it('declares the correct per-tool channel (runtime / editor / cli)', async () => {
    const profiles = await loadProfiles(REAL_PROFILES_PATH);
    const channelByName = new Map<string, string>();
    for (const t of profiles.tools) {
      channelByName.set(t.name, t.channel);
    }

    // Runtime-channel tools: execute, list_recipes, get_recipe,
    // simulate_cost. list_recipes and get_recipe are also exposed on the
    // editor channel in the design matrix, but the profile registration
    // picks a single authoritative channel per tool; we standardise on
    // `runtime` for those so the RPG-only profile exposes them during a
    // headless gameplay run without the editor being open.
    expect(channelByName.get('crafting.execute')).toBe('runtime');
    expect(channelByName.get('crafting.list_recipes')).toBe('runtime');
    expect(channelByName.get('crafting.get_recipe')).toBe('runtime');
    expect(channelByName.get('crafting.simulate_cost')).toBe('runtime');

    // Editor-channel tools: create/update/delete write to disk and run
    // through the Undo_Redo_Wrapper that lives in the editor plugin.
    expect(channelByName.get('crafting.create_recipe')).toBe('editor');
    expect(channelByName.get('crafting.update_recipe')).toBe('editor');
    expect(channelByName.get('crafting.delete_recipe')).toBe('editor');

    // validate_recipe is also exposed on the editor channel in the
    // design matrix. We standardise on `cli` so CI pipelines can invoke
    // it against a headless Godot without an editor session.
    expect(channelByName.get('crafting.validate_recipe')).toBe('cli');
  });
});
