/**
 * Tests for the `modules.check_compatibility` MCP tool.
 *
 * Compares `manifest.core_min_version` to the Core version sourced
 * from the Core repo's git tag, and falls back to a caller-supplied
 * `coreVersion` (legacy shim) when one is provided. Returns
 * `{compatible, core_version, core_min_version, module_id, reason?}`.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CoreVersionUnavailableError,
  ModuleNotFoundError,
} from '../../../src/tools/modules/errors.js';
import { ToolInputError } from '../../../src/tools/project/errors.js';
import { checkCompatibility } from '../../../src/tools/modules/check_compatibility.js';

function manifestFor(id: string, coreMin: string): string {
  return `[gd_resource type="Resource" script_class="ModuleManifest" load_steps=2 format=3]

[ext_resource type="Script" path="res://addons/forgekit_core/manifest/module_manifest.gd" id="1"]

[resource]
script = ExtResource("1")
id = &"${id}"
version = "0.1.0"
core_min_version = "${coreMin}"
depends_on = Array[StringName]([])
license_id = "${id}"
source_repo = "ForgeKitStudio/${id}"
`;
}

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-check-compat-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function installManifest(id: string, coreMin: string): Promise<void> {
  await mkdir(join(workspace, 'addons', id), { recursive: true });
  await writeFile(
    join(workspace, 'addons', id, 'module.manifest.tres'),
    manifestFor(id, coreMin),
  );
}

describe('checkCompatibility — legacy coreVersion shim', () => {
  it('reports compatible when core_version equals core_min_version', async () => {
    await installManifest('forgekit_rpg', '0.1.0');
    const result = await checkCompatibility({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
      coreVersion: '0.1.0',
    });
    expect(result.compatible).toBe(true);
    expect(result.core_version).toBe('0.1.0');
    expect(result.core_min_version).toBe('0.1.0');
    expect(result.module_id).toBe('forgekit_rpg');
  });

  it('reports compatible when core_version is higher than core_min_version', async () => {
    await installManifest('forgekit_rpg', '0.1.0');
    const result = await checkCompatibility({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
      coreVersion: '1.4.2',
    });
    expect(result.compatible).toBe(true);
  });

  it('reports incompatible with a reason when core_version is lower', async () => {
    await installManifest('forgekit_rpg', '1.2.0');
    const result = await checkCompatibility({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
      coreVersion: '1.1.9',
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/core_version/);
  });

  it('accepts a leading "v" prefix on either side', async () => {
    await installManifest('forgekit_rpg', 'v0.1.0');
    const result = await checkCompatibility({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
      coreVersion: 'v0.2.0',
    });
    expect(result.compatible).toBe(true);
  });

  it('reports incompatible with a malformed reason when core_min_version is garbage', async () => {
    await installManifest('forgekit_rpg', 'not-a-version');
    const result = await checkCompatibility({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
      coreVersion: '0.1.0',
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/malformed/i);
  });

  it('does not invoke the git resolver when a legacy coreVersion is supplied', async () => {
    await installManifest('forgekit_rpg', '0.1.0');
    const resolveVersion = vi.fn();
    await checkCompatibility({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
      coreVersion: '1.0.0',
      resolveVersion,
    });
    expect(resolveVersion).not.toHaveBeenCalled();
  });
});

describe('checkCompatibility — git-sourced coreVersion', () => {
  it('falls back to resolveVersion when coreVersion is omitted', async () => {
    await installManifest('forgekit_rpg', '0.1.0');
    const resolveVersion = vi.fn().mockResolvedValue('1.0.0');
    const result = await checkCompatibility({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
      resolveVersion,
    });
    expect(resolveVersion).toHaveBeenCalledWith(workspace);
    expect(result.core_version).toBe('1.0.0');
    expect(result.compatible).toBe(true);
  });

  it('surfaces CoreVersionUnavailableError from resolveVersion', async () => {
    await installManifest('forgekit_rpg', '0.1.0');
    const resolveVersion = vi
      .fn()
      .mockRejectedValue(
        new CoreVersionUnavailableError(
          'git_describe_failed',
          'fatal: No names found\n',
        ),
      );
    await expect(
      checkCompatibility({
        projectRoot: workspace,
        moduleId: 'forgekit_rpg',
        resolveVersion,
      }),
    ).rejects.toBeInstanceOf(CoreVersionUnavailableError);
  });

  it('marks a malformed git tag as incompatible rather than compatible by default', async () => {
    await installManifest('forgekit_rpg', '0.1.0');
    const resolveVersion = vi.fn().mockResolvedValue('garbage-tag');
    const result = await checkCompatibility({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
      resolveVersion,
    });
    expect(result.compatible).toBe(false);
    expect(result.core_version).toBe('garbage-tag');
    expect(result.reason).toMatch(/malformed/i);
  });

  it('reports incompatible when git tag is older than core_min_version', async () => {
    await installManifest('forgekit_rpg', '1.2.0');
    const resolveVersion = vi.fn().mockResolvedValue('1.1.9');
    const result = await checkCompatibility({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
      resolveVersion,
    });
    expect(result.compatible).toBe(false);
    expect(result.core_version).toBe('1.1.9');
    expect(result.reason).toMatch(/1\.1\.9/);
  });
});

describe('checkCompatibility — errors', () => {
  it('raises ModuleNotFoundError when the module is not installed', async () => {
    await expect(
      checkCompatibility({
        projectRoot: workspace,
        moduleId: 'forgekit_ghost',
        coreVersion: '0.1.0',
      }),
    ).rejects.toThrow(ModuleNotFoundError);
  });

  it('rejects an empty coreVersion', async () => {
    await installManifest('forgekit_rpg', '0.1.0');
    await expect(
      checkCompatibility({
        projectRoot: workspace,
        moduleId: 'forgekit_rpg',
        coreVersion: '',
      }),
    ).rejects.toThrow(ToolInputError);
  });
});


describe('checkCompatibility — required/installed aliases (phase 6.22.4)', () => {
  it('returns compatible:false with required + installed when the installed Core is older than core_min_version', async () => {
    await installManifest('forgekit_rpg', '0.9.0');
    const result = await checkCompatibility({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
      coreVersion: '0.7.0',
    });
    expect(result.compatible).toBe(false);
    expect(result.required).toBe('0.9.0');
    expect(result.installed).toBe('0.7.0');
    expect(result.core_min_version).toBe('0.9.0');
    expect(result.core_version).toBe('0.7.0');
  });

  it('returns required + installed on compatible responses too', async () => {
    await installManifest('forgekit_rpg', '0.5.0');
    const result = await checkCompatibility({
      projectRoot: workspace,
      moduleId: 'forgekit_rpg',
      coreVersion: '0.7.0',
    });
    expect(result.compatible).toBe(true);
    expect(result.required).toBe('0.5.0');
    expect(result.installed).toBe('0.7.0');
  });
});
