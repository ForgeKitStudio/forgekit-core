/**
 * Tests for the `project.list_modules` MCP tool.
 *
 * Returns `[{id, version, license_id, core_min_version, source_repo, enabled}]`
 * for every `forgekit_<id>` directory that ships a `module.manifest.tres`.
 * The `enabled` flag defaults to true and is meant to be flipped later by
 * `modules.disable` / `modules.enable`; the initial implementation treats
 * any discoverable module as enabled.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/project/errors.js';
import { listModules } from '../../../src/tools/project/list_modules.js';

const MANIFEST_RPG = `[gd_resource type="Resource" script_class="ModuleManifest" load_steps=2 format=3]

[ext_resource type="Script" path="res://addons/forgekit_core/manifest/module_manifest.gd" id="1"]

[resource]
script = ExtResource("1")
id = &"forgekit_rpg"
version = "0.3.0"
core_min_version = "0.1.0"
depends_on = Array[StringName]([])
license_id = "forgekit_rpg"
source_repo = "ForgeKitStudio/forgekit-rpg"
`;

const MANIFEST_SURVIVORS = `[gd_resource type="Resource" script_class="ModuleManifest" load_steps=2 format=3]

[ext_resource type="Script" path="res://addons/forgekit_core/manifest/module_manifest.gd" id="1"]

[resource]
script = ExtResource("1")
id = &"forgekit_survivors"
version = "0.0.1"
core_min_version = "0.1.0"
depends_on = Array[StringName]([&"forgekit_rpg"])
license_id = "forgekit_survivors"
source_repo = "ForgeKitStudio/forgekit-survivors"
`;

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-list-modules-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function installManifest(dir: string, text: string): Promise<void> {
  await mkdir(join(workspace, 'addons', dir), { recursive: true });
  await writeFile(
    join(workspace, 'addons', dir, 'module.manifest.tres'),
    text,
  );
}

describe('listModules — happy path', () => {
  it('returns an empty array when no modules are installed', async () => {
    const result = await listModules({ projectRoot: workspace });
    expect(result.modules).toEqual([]);
  });

  it('returns one entry per forgekit_* directory with a manifest', async () => {
    await installManifest('forgekit_rpg', MANIFEST_RPG);
    await installManifest('forgekit_survivors', MANIFEST_SURVIVORS);
    const result = await listModules({ projectRoot: workspace });
    expect(result.modules).toHaveLength(2);
  });

  it('sorts modules by id for deterministic output', async () => {
    await installManifest('forgekit_survivors', MANIFEST_SURVIVORS);
    await installManifest('forgekit_rpg', MANIFEST_RPG);
    const result = await listModules({ projectRoot: workspace });
    expect(result.modules.map((m) => m.id)).toEqual([
      'forgekit_rpg',
      'forgekit_survivors',
    ]);
  });

  it('exposes all six required fields per module', async () => {
    await installManifest('forgekit_rpg', MANIFEST_RPG);
    const result = await listModules({ projectRoot: workspace });
    expect(result.modules[0]).toEqual({
      id: 'forgekit_rpg',
      version: '0.3.0',
      license_id: 'forgekit_rpg',
      core_min_version: '0.1.0',
      source_repo: 'ForgeKitStudio/forgekit-rpg',
      enabled: true,
    });
  });

  it('skips forgekit_core and forgekit_* placeholders without a manifest', async () => {
    // forgekit_core has a manifest but must not appear as a module.
    await installManifest('forgekit_core', MANIFEST_RPG);
    // forgekit_rpg is present but only as a placeholder.
    await mkdir(join(workspace, 'addons', 'forgekit_rpg'), { recursive: true });
    await writeFile(join(workspace, 'addons', 'forgekit_rpg', '.gitkeep'), '');
    const result = await listModules({ projectRoot: workspace });
    expect(result.modules).toEqual([]);
  });

  it('returns modules with empty source_repo when the manifest omits it', async () => {
    const manifestNoRepo = MANIFEST_RPG.replace(
      /source_repo = "[^"]*"\n/,
      '',
    );
    await installManifest('forgekit_rpg', manifestNoRepo);
    const result = await listModules({ projectRoot: workspace });
    expect(result.modules[0].source_repo).toBe('');
  });
});

describe('listModules — validation', () => {
  it('rejects an empty projectRoot', async () => {
    await expect(listModules({ projectRoot: '' })).rejects.toThrow(
      ToolInputError,
    );
  });
});
