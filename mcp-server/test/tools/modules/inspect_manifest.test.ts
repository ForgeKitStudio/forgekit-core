/**
 * Tests for the `modules.inspect_manifest` MCP tool.
 *
 * Returns the full manifest object for a given module id (including
 * `depends_on`) plus the `manifest_path` that was read. Raises
 * `MODULE_NOT_FOUND` when the id is not installed.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/project/errors.js';
import { ModuleNotFoundError } from '../../../src/tools/modules/errors.js';
import { inspectManifest } from '../../../src/tools/modules/inspect_manifest.js';

const MANIFEST_RPG = `[gd_resource type="Resource" script_class="ModuleManifest" load_steps=2 format=3]

[ext_resource type="Script" path="res://addons/forgekit_core/manifest/module_manifest.gd" id="1"]

[resource]
script = ExtResource("1")
id = &"forgekit_rpg"
version = "0.3.0"
core_min_version = "0.1.0"
depends_on = Array[StringName]([&"forgekit_core"])
license_id = "forgekit_rpg"
source_repo = "ForgeKitStudio/forgekit-rpg"
`;

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-inspect-manifest-'));
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

describe('inspectManifest — happy path', () => {
  it('returns the full manifest including depends_on and manifest_path', async () => {
    await installManifest('forgekit_rpg', MANIFEST_RPG);
    const result = await inspectManifest({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
    });
    expect(result).toEqual({
      id: 'forgekit_rpg',
      version: '0.3.0',
      core_min_version: '0.1.0',
      depends_on: ['forgekit_core'],
      license_id: 'forgekit_rpg',
      source_repo: 'ForgeKitStudio/forgekit-rpg',
      manifest_path: join(
        workspace,
        'addons',
        'forgekit_rpg',
        'module.manifest.tres',
      ),
    });
  });
});

describe('inspectManifest — errors', () => {
  it('raises ModuleNotFoundError when the id is not installed', async () => {
    await expect(
      inspectManifest({
        projectRoot: workspace,
        moduleId: 'forgekit_ghost',
      }),
    ).rejects.toThrow(ModuleNotFoundError);
  });

  it('rejects an empty moduleId', async () => {
    await expect(
      inspectManifest({ projectRoot: workspace, moduleId: '' }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty projectRoot', async () => {
    await expect(
      inspectManifest({ projectRoot: '', moduleId: 'forgekit_rpg' }),
    ).rejects.toThrow(ToolInputError);
  });
});
