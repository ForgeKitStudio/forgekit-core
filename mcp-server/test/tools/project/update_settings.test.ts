/**
 * Tests for the `project.update_settings` MCP tool.
 *
 * The tool performs atomic read → parse → merge → write-temp → fsync →
 * rename on `project.godot`. The critical invariants:
 *
 *   1. Keys absent from `patch` are byte-exact preserved (this is the
 *      bug fix vs tomyud1/godot-mcp, which dropped input events on
 *      update_project_settings).
 *   2. Keys present in `patch` take the patch value verbatim. Values
 *      are raw strings — the caller provides the final Godot literal
 *      (e.g. `"\"After Edit\""` or `'PackedStringArray("4.3")'`).
 *   3. Keys in new sections or new keys inside existing sections are
 *      appended in insertion order.
 *   4. The response carries `{applied: {...}, previous: {...}}` so the
 *      caller (and Undo wrapper on the Godot side) can reason about
 *      the diff.
 *   5. The temp file is never left behind on success; the original
 *      file is replaced atomically by rename.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ProjectIoError,
  ToolInputError,
} from '../../../src/tools/project/errors.js';
import { updateSettings } from '../../../src/tools/project/update_settings.js';

const BASE_PROJECT = `; Engine configuration file.

config_version=5

[application]

config/name="Original"
config/features=PackedStringArray("4.3", "Forward Plus")

[input]

ui_accept/events=[InputEventKey_A]
ui_cancel/events=[InputEventKey_Escape]
`;

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-update-settings-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function readProjectGodot(): Promise<string> {
  return readFile(join(workspace, 'project.godot'), 'utf8');
}

describe('updateSettings — per-key merge', () => {
  it('replaces the requested key without touching any sibling key', async () => {
    await writeFile(join(workspace, 'project.godot'), BASE_PROJECT);
    await updateSettings({
      projectRoot: workspace,
      patch: { 'application/config/name': '"After Edit"' },
    });
    const text = await readProjectGodot();
    expect(text).toContain('config/name="After Edit"');
    // The features key must be unchanged.
    expect(text).toContain(
      'config/features=PackedStringArray("4.3", "Forward Plus")',
    );
    // Input section must survive intact.
    expect(text).toContain('ui_accept/events=[InputEventKey_A]');
    expect(text).toContain('ui_cancel/events=[InputEventKey_Escape]');
  });

  it('preserves untouched input actions when updating one action (tomyud1 regression)', async () => {
    await writeFile(join(workspace, 'project.godot'), BASE_PROJECT);
    await updateSettings({
      projectRoot: workspace,
      patch: { 'input/ui_accept/events': '[InputEventKey_Space]' },
    });
    const text = await readProjectGodot();
    expect(text).toContain('ui_accept/events=[InputEventKey_Space]');
    expect(text).toContain('ui_cancel/events=[InputEventKey_Escape]');
  });

  it('appends a new key inside an existing section at the end of that section', async () => {
    await writeFile(join(workspace, 'project.godot'), BASE_PROJECT);
    await updateSettings({
      projectRoot: workspace,
      patch: { 'application/config/description': '"New description"' },
    });
    const text = await readProjectGodot();
    // The description line must appear after existing application keys
    // and before the [input] header.
    const idxDesc = text.indexOf('config/description="New description"');
    const idxInput = text.indexOf('[input]');
    expect(idxDesc).toBeGreaterThan(-1);
    expect(idxDesc).toBeLessThan(idxInput);
  });

  it('appends a new section at the end of the file when the section does not exist', async () => {
    await writeFile(join(workspace, 'project.godot'), BASE_PROJECT);
    await updateSettings({
      projectRoot: workspace,
      patch: { 'rendering/quality/shadows': '"high"' },
    });
    const text = await readProjectGodot();
    expect(text).toContain('[rendering]');
    expect(text).toContain('quality/shadows="high"');
    // The new section must come after [input].
    expect(text.indexOf('[input]')).toBeLessThan(text.indexOf('[rendering]'));
  });

  it('does not modify a key whose value equals the existing one (idempotent)', async () => {
    await writeFile(join(workspace, 'project.godot'), BASE_PROJECT);
    const before = await readProjectGodot();
    const result = await updateSettings({
      projectRoot: workspace,
      patch: { 'application/config/name': '"Original"' },
    });
    const after = await readProjectGodot();
    expect(after).toBe(before);
    // No "applied" diff because nothing changed.
    expect(result.applied).toEqual({});
  });
});

describe('updateSettings — response shape', () => {
  it('returns {applied, previous} with string values for each changed key', async () => {
    await writeFile(join(workspace, 'project.godot'), BASE_PROJECT);
    const result = await updateSettings({
      projectRoot: workspace,
      patch: {
        'application/config/name': '"After Edit"',
        'application/config/description': '"New description"',
      },
    });
    expect(result.applied).toEqual({
      'application/config/name': '"After Edit"',
      'application/config/description': '"New description"',
    });
    expect(result.previous).toEqual({
      'application/config/name': '"Original"',
      // Previous value of a new key is null, marshaled as null not ''.
      'application/config/description': null,
    });
  });
});

describe('updateSettings — atomicity', () => {
  it('leaves no stray temp files on success', async () => {
    await writeFile(join(workspace, 'project.godot'), BASE_PROJECT);
    await updateSettings({
      projectRoot: workspace,
      patch: { 'application/config/name': '"After Edit"' },
    });
    const entries = await readdir(workspace);
    expect(entries).toEqual(['project.godot']);
  });
});

describe('updateSettings — validation and errors', () => {
  it('rejects an empty projectRoot', async () => {
    await expect(
      updateSettings({ projectRoot: '', patch: { 'a/b': '"c"' } }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty patch (nothing to apply is surely a caller bug)', async () => {
    await writeFile(join(workspace, 'project.godot'), BASE_PROJECT);
    await expect(
      updateSettings({ projectRoot: workspace, patch: {} }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects a patch key without a "/" (caller must specify section/key)', async () => {
    await writeFile(join(workspace, 'project.godot'), BASE_PROJECT);
    await expect(
      updateSettings({
        projectRoot: workspace,
        patch: { 'topLevelOnly': '"x"' },
      }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects a non-string patch value (caller must pre-serialize literals)', async () => {
    await writeFile(join(workspace, 'project.godot'), BASE_PROJECT);
    await expect(
      updateSettings({
        projectRoot: workspace,
        patch: { 'application/config/name': 42 as unknown as string },
      }),
    ).rejects.toThrow(ToolInputError);
  });

  it('raises ProjectIoError when project.godot is missing', async () => {
    await expect(
      updateSettings({
        projectRoot: workspace,
        patch: { 'application/config/name': '"x"' },
      }),
    ).rejects.toThrow(ProjectIoError);
  });
});
