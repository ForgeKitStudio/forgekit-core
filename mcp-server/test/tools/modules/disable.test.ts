/**
 * Tests for the `modules.disable` MCP tool.
 *
 * Flips the persisted `enabled` flag to `false` for a given module id.
 * Writes to the same state file as `enableModule`.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ModuleNotFoundError } from '../../../src/tools/modules/errors.js';
import { disableModule } from '../../../src/tools/modules/disable.js';
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

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-modules-disable-'));
  await mkdir(join(workspace, 'addons', 'forgekit_rpg'), { recursive: true });
  await writeFile(
    join(workspace, 'addons', 'forgekit_rpg', 'module.manifest.tres'),
    MANIFEST_RPG,
  );
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('disableModule — happy path', () => {
  it('creates the state file and sets enabled=false', async () => {
    await disableModule({ projectRoot: workspace, moduleId: 'forgekit_rpg' });
    const stateText = await readFile(
      join(workspace, '.forgekit', 'modules_state.json'),
      'utf8',
    );
    expect(JSON.parse(stateText)).toEqual({
      forgekit_rpg: { enabled: false },
    });
  });

  it('returns {module_id, enabled: false}', async () => {
    const result = await disableModule({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
    });
    expect(result).toEqual({ module_id: 'forgekit_rpg', enabled: false });
  });

  it('changes the module listing to enabled=false via list round-trip', async () => {
    const before = await modulesList({
      projectRoot: workspace,
      licenseDir: join(workspace, 'licenses'),
    });
    expect(before.modules[0].enabled).toBe(true);

    await disableModule({ projectRoot: workspace, moduleId: 'forgekit_rpg' });

    const after = await modulesList({
      projectRoot: workspace,
      licenseDir: join(workspace, 'licenses'),
    });
    expect(after.modules[0].enabled).toBe(false);
  });
});

describe('disableModule — errors', () => {
  it('raises ModuleNotFoundError when the module does not exist', async () => {
    await expect(
      disableModule({ projectRoot: workspace, moduleId: 'forgekit_ghost' }),
    ).rejects.toThrow(ModuleNotFoundError);
  });
});
