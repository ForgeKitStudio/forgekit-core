/**
 * Tests for the `project.info` MCP tool.
 *
 * The tool reads `project.godot` and enumerates the installed modules to
 * return `{name, godot_version, api_version, modules_count, root_path}`.
 * All filesystem access goes through `node:fs/promises`; tests use a
 * temporary directory so the behavior is deterministic and platform
 * independent.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectIoError, ToolInputError } from '../../../src/tools/project/errors.js';
import { projectInfo } from '../../../src/tools/project/info.js';

const PROJECT_GODOT = `; Engine configuration file.

config_version=5

[application]

config/name="ForgeKit Core Template"
config/features=PackedStringArray("4.3", "Forward Plus")

[autoload]

GameEvents="*res://addons/forgekit_core/event_bus/game_events.gd"
`;

const MINIMAL_MANIFEST = `[gd_resource type="Resource" script_class="ModuleManifest" load_steps=2 format=3]

[ext_resource type="Script" path="res://addons/forgekit_core/manifest/module_manifest.gd" id="1"]

[resource]
script = ExtResource("1")
id = &"forgekit_rpg"
version = "0.0.1"
core_min_version = "0.0.1"
depends_on = Array[StringName]([])
license_id = "forgekit_rpg"
source_repo = "ForgeKitStudio/forgekit-rpg"
`;

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-info-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('projectInfo — happy path', () => {
  it('returns name from [application] config/name, unquoted', async () => {
    await writeFile(join(workspace, 'project.godot'), PROJECT_GODOT);
    const info = await projectInfo({ projectRoot: workspace, apiVersion: '0.1.0' });
    expect(info.name).toBe('ForgeKit Core Template');
  });

  it('extracts godot_version from [application] config/features', async () => {
    await writeFile(join(workspace, 'project.godot'), PROJECT_GODOT);
    const info = await projectInfo({ projectRoot: workspace, apiVersion: '0.1.0' });
    expect(info.godot_version).toBe('4.3');
  });

  it('passes api_version through from the caller', async () => {
    await writeFile(join(workspace, 'project.godot'), PROJECT_GODOT);
    const info = await projectInfo({ projectRoot: workspace, apiVersion: '0.42.17' });
    expect(info.api_version).toBe('0.42.17');
  });

  it('returns the absolute project root under root_path', async () => {
    await writeFile(join(workspace, 'project.godot'), PROJECT_GODOT);
    const info = await projectInfo({ projectRoot: workspace, apiVersion: '0.1.0' });
    expect(info.root_path).toBe(workspace);
  });

  it('counts forgekit_* module directories that contain a module.manifest.tres', async () => {
    await writeFile(join(workspace, 'project.godot'), PROJECT_GODOT);
    await mkdir(join(workspace, 'addons', 'forgekit_core'), { recursive: true });
    await mkdir(join(workspace, 'addons', 'forgekit_rpg'), { recursive: true });
    await writeFile(
      join(workspace, 'addons', 'forgekit_rpg', 'module.manifest.tres'),
      MINIMAL_MANIFEST,
    );
    const info = await projectInfo({ projectRoot: workspace, apiVersion: '0.1.0' });
    expect(info.modules_count).toBe(1);
  });

  it('does not count forgekit_core or gut as modules', async () => {
    await writeFile(join(workspace, 'project.godot'), PROJECT_GODOT);
    await mkdir(join(workspace, 'addons', 'forgekit_core'), { recursive: true });
    await mkdir(join(workspace, 'addons', 'gut'), { recursive: true });
    // Even a manifest inside forgekit_core doesn't count — Core is not a
    // module.
    await writeFile(
      join(workspace, 'addons', 'forgekit_core', 'module.manifest.tres'),
      MINIMAL_MANIFEST,
    );
    const info = await projectInfo({ projectRoot: workspace, apiVersion: '0.1.0' });
    expect(info.modules_count).toBe(0);
  });

  it('ignores forgekit_* directories that only contain a .gitkeep placeholder', async () => {
    await writeFile(join(workspace, 'project.godot'), PROJECT_GODOT);
    await mkdir(join(workspace, 'addons', 'forgekit_rpg'), { recursive: true });
    await writeFile(join(workspace, 'addons', 'forgekit_rpg', '.gitkeep'), '');
    const info = await projectInfo({ projectRoot: workspace, apiVersion: '0.1.0' });
    expect(info.modules_count).toBe(0);
  });
});

describe('projectInfo — validation and errors', () => {
  it('rejects an empty projectRoot', async () => {
    await expect(
      projectInfo({ projectRoot: '', apiVersion: '0.1.0' }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty apiVersion', async () => {
    await expect(
      projectInfo({ projectRoot: workspace, apiVersion: '' }),
    ).rejects.toThrow(ToolInputError);
  });

  it('raises ProjectIoError when project.godot is missing', async () => {
    await expect(
      projectInfo({ projectRoot: workspace, apiVersion: '0.1.0' }),
    ).rejects.toThrow(ProjectIoError);
  });

  it('returns godot_version="unknown" when config/features lacks a version literal', async () => {
    await writeFile(
      join(workspace, 'project.godot'),
      `config_version=5\n\n[application]\n\nconfig/name="X"\n`,
    );
    const info = await projectInfo({ projectRoot: workspace, apiVersion: '0.1.0' });
    expect(info.godot_version).toBe('unknown');
  });
});
