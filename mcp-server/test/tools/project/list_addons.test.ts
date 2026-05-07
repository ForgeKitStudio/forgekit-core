/**
 * Tests for the `project.list_addons` MCP tool.
 *
 * The tool walks `<projectRoot>/addons/*` and reports every directory
 * that ships a `plugin.cfg`. Each entry carries `{id, enabled, path}`:
 *
 *   id:      the directory name (conventionally matches plugin.cfg
 *            `name=`; we use the directory name because it's the stable
 *            filesystem identifier Godot uses to key the editor list).
 *   enabled: true when `[editor_plugins].enabled` in `project.godot`
 *            contains the addon path. `editor_plugins` is the Godot
 *            4.x field where enabled EditorPlugin instances are listed.
 *   path:    `res://addons/<dir>` URI so callers can pass it straight
 *            to scene/resource APIs.
 *
 * Addons without a `plugin.cfg` (vendored helpers, placeholders) are
 * not reported — Godot ignores them, and so do we.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/project/errors.js';
import { listAddons } from '../../../src/tools/project/list_addons.js';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-list-addons-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function installAddon(dir: string, pluginCfg: string): Promise<void> {
  await mkdir(join(workspace, 'addons', dir), { recursive: true });
  await writeFile(join(workspace, 'addons', dir, 'plugin.cfg'), pluginCfg);
}

const CORE_CFG = `[plugin]
name="ForgeKit Core"
version="0.0.1"
script="plugin.gd"
`;

describe('listAddons — discovery', () => {
  it('returns an empty list when there are no addons', async () => {
    const result = await listAddons({ projectRoot: workspace });
    expect(result.addons).toEqual([]);
  });

  it('lists every addons/<dir> that has a plugin.cfg', async () => {
    await installAddon('forgekit_core', CORE_CFG);
    await installAddon('gut', '[plugin]\nname="GUT"\n');
    const result = await listAddons({ projectRoot: workspace });
    expect(result.addons.map((a) => a.id)).toEqual(['forgekit_core', 'gut']);
  });

  it('skips directories without a plugin.cfg', async () => {
    await installAddon('forgekit_core', CORE_CFG);
    await mkdir(join(workspace, 'addons', 'forgekit_rpg'), { recursive: true });
    await writeFile(join(workspace, 'addons', 'forgekit_rpg', '.gitkeep'), '');
    const result = await listAddons({ projectRoot: workspace });
    expect(result.addons.map((a) => a.id)).toEqual(['forgekit_core']);
  });

  it('returns path as res://addons/<id>', async () => {
    await installAddon('forgekit_core', CORE_CFG);
    const result = await listAddons({ projectRoot: workspace });
    expect(result.addons[0].path).toBe('res://addons/forgekit_core');
  });
});

describe('listAddons — enabled flag', () => {
  it('marks addon enabled when project.godot [editor_plugins] enabled contains its plugin.cfg path', async () => {
    await installAddon('forgekit_core', CORE_CFG);
    await installAddon('gut', '[plugin]\nname="GUT"\n');
    await writeFile(
      join(workspace, 'project.godot'),
      [
        'config_version=5',
        '',
        '[editor_plugins]',
        '',
        'enabled=PackedStringArray("res://addons/forgekit_core/plugin.cfg")',
        '',
      ].join('\n'),
    );
    const result = await listAddons({ projectRoot: workspace });
    const byId = Object.fromEntries(result.addons.map((a) => [a.id, a.enabled]));
    expect(byId['forgekit_core']).toBe(true);
    expect(byId['gut']).toBe(false);
  });

  it('treats every addon as disabled when project.godot is missing', async () => {
    await installAddon('forgekit_core', CORE_CFG);
    const result = await listAddons({ projectRoot: workspace });
    expect(result.addons[0].enabled).toBe(false);
  });

  it('treats every addon as disabled when [editor_plugins] is absent', async () => {
    await installAddon('forgekit_core', CORE_CFG);
    await writeFile(
      join(workspace, 'project.godot'),
      'config_version=5\n\n[application]\n\nconfig/name="x"\n',
    );
    const result = await listAddons({ projectRoot: workspace });
    expect(result.addons[0].enabled).toBe(false);
  });
});

describe('listAddons — validation', () => {
  it('rejects an empty projectRoot', async () => {
    await expect(listAddons({ projectRoot: '' })).rejects.toThrow(
      ToolInputError,
    );
  });
});
