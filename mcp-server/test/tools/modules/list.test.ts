/**
 * Tests for the `modules.list` MCP tool.
 *
 * `modules.list` is a thin wrapper over `scanModules` that also reports a
 * `has_active_license` flag based on whether `<licenseDir>/<module_id>.key`
 * exists, and an `enabled` flag derived from the persisted state file at
 * `<projectRoot>/.forgekit/modules_state.json`. Results are sorted by id.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/project/errors.js';
import { modulesList } from '../../../src/tools/modules/list.js';

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
let licenseDir: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-modules-list-'));
  licenseDir = join(workspace, 'licenses');
  await mkdir(licenseDir, { recursive: true });
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

async function writeLicenseKey(moduleId: string): Promise<void> {
  await writeFile(
    join(licenseDir, `${moduleId}.key`),
    JSON.stringify({
      license_id: moduleId,
      activated_at: '2025-01-01T00:00:00',
      fingerprint: 'dead',
    }),
  );
}

describe('modulesList — happy path', () => {
  it('returns an empty array when no modules are installed', async () => {
    const result = await modulesList({ projectRoot: workspace, licenseDir });
    expect(result.modules).toEqual([]);
  });

  it('lists discovered modules sorted by id', async () => {
    await installManifest('forgekit_survivors', MANIFEST_SURVIVORS);
    await installManifest('forgekit_rpg', MANIFEST_RPG);
    const result = await modulesList({ projectRoot: workspace, licenseDir });
    expect(result.modules.map((m) => m.id)).toEqual([
      'forgekit_rpg',
      'forgekit_survivors',
    ]);
  });

  it('exposes the expected seven fields per module', async () => {
    await installManifest('forgekit_rpg', MANIFEST_RPG);
    const result = await modulesList({ projectRoot: workspace, licenseDir });
    expect(result.modules[0]).toEqual({
      id: 'forgekit_rpg',
      version: '0.3.0',
      license_id: 'forgekit_rpg',
      core_min_version: '0.1.0',
      source_repo: 'ForgeKitStudio/forgekit-rpg',
      enabled: true,
      has_active_license: false,
    });
  });

  it('reports has_active_license=true when a license key file exists', async () => {
    await installManifest('forgekit_rpg', MANIFEST_RPG);
    await writeLicenseKey('forgekit_rpg');
    const result = await modulesList({ projectRoot: workspace, licenseDir });
    expect(result.modules[0].has_active_license).toBe(true);
  });

  it('defaults has_active_license=false when the license dir does not exist', async () => {
    await installManifest('forgekit_rpg', MANIFEST_RPG);
    const result = await modulesList({
      projectRoot: workspace,
      licenseDir: join(workspace, 'no-such-dir'),
    });
    expect(result.modules[0].has_active_license).toBe(false);
  });

  it('honors a disabled state from the persisted state file', async () => {
    await installManifest('forgekit_rpg', MANIFEST_RPG);
    await mkdir(join(workspace, '.forgekit'), { recursive: true });
    await writeFile(
      join(workspace, '.forgekit', 'modules_state.json'),
      JSON.stringify({ forgekit_rpg: { enabled: false } }),
    );
    const result = await modulesList({ projectRoot: workspace, licenseDir });
    expect(result.modules[0].enabled).toBe(false);
  });
});

describe('modulesList — validation', () => {
  it('rejects an empty projectRoot', async () => {
    await expect(
      modulesList({ projectRoot: '', licenseDir }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty licenseDir', async () => {
    await expect(
      modulesList({ projectRoot: workspace, licenseDir: '' }),
    ).rejects.toThrow(ToolInputError);
  });
});
