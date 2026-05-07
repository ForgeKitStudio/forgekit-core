/**
 * Tests for the `project.check_imports` MCP tool.
 *
 * The tool is a static analyzer over every `.gd` file under
 * `addons/forgekit_core/**` and `addons/forgekit_rpg/**`. It enforces:
 *
 *   - Rule 1.2: ForgeKit_Core MUST NOT preload/load/extends any file
 *     under `addons/forgekit_<non-core>/`.
 *   - Rule 1.3: Subsystems inside `addons/forgekit_rpg/<subsystem>/` MUST
 *     only reach other subsystems via `addons/forgekit_rpg/public_api.gd`.
 *     Direct imports of `addons/forgekit_rpg/<other_subsystem>/**` are
 *     disallowed. Imports of `addons/forgekit_core/**` are allowed.
 *
 * Every violation contains `{file, imports, reason}` so the AI agent can
 * act on it directly without re-scanning the file.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/project/errors.js';
import { checkImports } from '../../../src/tools/project/check_imports.js';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-check-imports-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function writeGd(relativePath: string, contents: string): Promise<void> {
  const full = join(workspace, relativePath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, contents);
}

describe('checkImports — clean project', () => {
  it('returns an empty violations array when imports obey the rules', async () => {
    await writeGd(
      'addons/forgekit_core/event_bus/game_events.gd',
      `extends Node\nvar _x = preload("res://addons/forgekit_core/resources/item_resource.gd")\n`,
    );
    await writeGd(
      'addons/forgekit_rpg/combat/hitbox.gd',
      `extends Area3D\nvar _item = preload("res://addons/forgekit_core/resources/item_resource.gd")\nvar _api = preload("res://addons/forgekit_rpg/public_api.gd")\n`,
    );
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toEqual([]);
  });
});

describe('checkImports — rule 1.2 (Core → non-core module)', () => {
  it('flags preload() in forgekit_core that targets forgekit_rpg', async () => {
    await writeGd(
      'addons/forgekit_core/manifest/module_loader.gd',
      `extends Node\nvar _leak = preload("res://addons/forgekit_rpg/combat/hitbox.gd")\n`,
    );
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].file).toBe(
      'addons/forgekit_core/manifest/module_loader.gd',
    );
    expect(result.violations[0].imports).toEqual([
      'res://addons/forgekit_rpg/combat/hitbox.gd',
    ]);
    expect(result.violations[0].reason).toMatch(
      /ForgeKit_Core.*must not import.*forgekit_rpg/i,
    );
  });

  it('flags load() and const preload alike', async () => {
    await writeGd(
      'addons/forgekit_core/a.gd',
      `extends Node\nvar _x = load("res://addons/forgekit_rpg/combat/hitbox.gd")\n`,
    );
    await writeGd(
      'addons/forgekit_core/b.gd',
      `extends Node\nconst X = preload("res://addons/forgekit_rpg/crafting/manager.gd")\n`,
    );
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toHaveLength(2);
  });

  it('flags extends "res://..." when the target is another forgekit module', async () => {
    await writeGd(
      'addons/forgekit_core/x.gd',
      `extends "res://addons/forgekit_rpg/stats/base.gd"\n`,
    );
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toHaveLength(1);
  });
});

describe('checkImports — rule 1.3 (RPG subsystem → non-public-api)', () => {
  it('flags combat/ importing crafting/ directly', async () => {
    await writeGd(
      'addons/forgekit_rpg/combat/hitbox.gd',
      `extends Area3D\nvar _cm = preload("res://addons/forgekit_rpg/crafting/manager.gd")\n`,
    );
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].reason).toMatch(
      /subsystem.*public_api/i,
    );
  });

  it('allows combat/ importing forgekit_rpg/public_api.gd', async () => {
    await writeGd(
      'addons/forgekit_rpg/combat/hitbox.gd',
      `extends Area3D\nvar _api = preload("res://addons/forgekit_rpg/public_api.gd")\n`,
    );
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toEqual([]);
  });

  it('allows combat/ importing a file inside the same subsystem', async () => {
    await writeGd(
      'addons/forgekit_rpg/combat/hitbox.gd',
      `extends Area3D\nvar _sm = preload("res://addons/forgekit_rpg/combat/state_machine.gd")\n`,
    );
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toEqual([]);
  });

  it('allows combat/ importing forgekit_core', async () => {
    await writeGd(
      'addons/forgekit_rpg/combat/hitbox.gd',
      `extends Area3D\nvar _r = preload("res://addons/forgekit_core/resources/item_resource.gd")\n`,
    );
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toEqual([]);
  });

  it('flags a subsystem importing an unrelated forgekit_* addon', async () => {
    await writeGd(
      'addons/forgekit_rpg/combat/hitbox.gd',
      `extends Area3D\nvar _s = preload("res://addons/forgekit_survivors/bullets.gd")\n`,
    );
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].reason).toMatch(
      /must not import.*forgekit_survivors/i,
    );
  });

  it('aggregates multiple bad imports from the same file into one violation', async () => {
    await writeGd(
      'addons/forgekit_rpg/combat/hitbox.gd',
      [
        'extends Area3D',
        'var _a = preload("res://addons/forgekit_rpg/crafting/manager.gd")',
        'var _b = preload("res://addons/forgekit_rpg/inventory/inventory.gd")',
        '',
      ].join('\n'),
    );
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].imports).toEqual([
      'res://addons/forgekit_rpg/crafting/manager.gd',
      'res://addons/forgekit_rpg/inventory/inventory.gd',
    ]);
  });
});

describe('checkImports — indifference to unrelated code', () => {
  it('does not scan files outside addons/', async () => {
    await writeGd('tests/unit/test_x.gd', `var _x = preload("res://addons/forgekit_rpg/combat/hitbox.gd")\n`);
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toEqual([]);
  });

  it('ignores non-.gd files', async () => {
    await writeGd(
      'addons/forgekit_core/README.md',
      'preload("res://addons/forgekit_rpg/combat/hitbox.gd")',
    );
    const result = await checkImports({ projectRoot: workspace });
    expect(result.violations).toEqual([]);
  });
});

describe('checkImports — validation', () => {
  it('rejects an empty projectRoot', async () => {
    await expect(checkImports({ projectRoot: '' })).rejects.toThrow(
      ToolInputError,
    );
  });
});
