/**
 * Tests for the `project.get_settings` MCP tool.
 *
 * The tool reads `project.godot` from disk (no editor-memory fallback).
 * Values are returned verbatim — no string unquoting, no literal
 * coercion — so that `project.update_settings` can round-trip the exact
 * text back into the file.
 *
 * When called without `section`, returns every `<section>/<key>`. When
 * called with `section: "application"`, returns only the keys that live
 * inside `[application]`, stripped to `<key>` form.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ProjectIoError,
  ToolInputError,
} from '../../../src/tools/project/errors.js';
import { getSettings } from '../../../src/tools/project/get_settings.js';

const PROJECT_GODOT = `config_version=5

[application]

config/name="ForgeKit Core Template"
config/features=PackedStringArray("4.3", "Forward Plus")

[autoload]

GameEvents="*res://addons/forgekit_core/event_bus/game_events.gd"
McpBridge="*res://addons/forgekit_core/mcp/runtime_bridge/mcp_bridge.gd"

[input]

ui_accept/events=[InputEventKey]
`;

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-get-settings-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('getSettings — full dump', () => {
  it('returns every <section>/<key> with verbatim values when section is omitted', async () => {
    await writeFile(join(workspace, 'project.godot'), PROJECT_GODOT);
    const result = await getSettings({ projectRoot: workspace });
    expect(result.settings['application/config/name']).toBe(
      '"ForgeKit Core Template"',
    );
    expect(result.settings['autoload/GameEvents']).toBe(
      '"*res://addons/forgekit_core/event_bus/game_events.gd"',
    );
    expect(result.settings['input/ui_accept/events']).toBe(
      '[InputEventKey]',
    );
  });

  it('re-reads the file on each call (no caching of stale state)', async () => {
    const path = join(workspace, 'project.godot');
    await writeFile(path, PROJECT_GODOT);
    const first = await getSettings({ projectRoot: workspace });
    expect(first.settings['application/config/name']).toBe(
      '"ForgeKit Core Template"',
    );
    await writeFile(
      path,
      PROJECT_GODOT.replace(
        'config/name="ForgeKit Core Template"',
        'config/name="After Edit"',
      ),
    );
    const second = await getSettings({ projectRoot: workspace });
    expect(second.settings['application/config/name']).toBe('"After Edit"');
  });
});

describe('getSettings — section filter', () => {
  it('returns only the requested section and strips the section prefix', async () => {
    await writeFile(join(workspace, 'project.godot'), PROJECT_GODOT);
    const result = await getSettings({
      projectRoot: workspace,
      section: 'application',
    });
    expect(result.settings).toEqual({
      'config/name': '"ForgeKit Core Template"',
      'config/features': 'PackedStringArray("4.3", "Forward Plus")',
    });
  });

  it('returns an empty settings object when the section does not exist', async () => {
    await writeFile(join(workspace, 'project.godot'), PROJECT_GODOT);
    const result = await getSettings({
      projectRoot: workspace,
      section: 'rendering',
    });
    expect(result.settings).toEqual({});
  });
});

describe('getSettings — validation and errors', () => {
  it('rejects an empty projectRoot', async () => {
    await expect(getSettings({ projectRoot: '' })).rejects.toThrow(
      ToolInputError,
    );
  });

  it('rejects a section with a slash (would be ambiguous with subkeys)', async () => {
    await writeFile(join(workspace, 'project.godot'), PROJECT_GODOT);
    await expect(
      getSettings({ projectRoot: workspace, section: 'application/config' }),
    ).rejects.toThrow(ToolInputError);
  });

  it('raises ProjectIoError when project.godot is missing', async () => {
    await expect(getSettings({ projectRoot: workspace })).rejects.toThrow(
      ProjectIoError,
    );
  });
});
