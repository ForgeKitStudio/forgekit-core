/**
 * Tests for the `analysis.count_nodes_by_type` MCP tool.
 *
 * Walks every `.tscn` file under `projectRoot` (or, when `root` is
 * supplied, under `<projectRoot>/<root>/` only) and counts nodes by
 * their `type=...` attribute in `[node ...]` headers. For inherited
 * scenes the header can be `[node name="..." parent="..." instance=...]`
 * with no `type` field; those nodes are counted under the synthetic
 * bucket `"<instance>"` so the total always reflects every node in
 * the scene tree.
 *
 * Returns `{counts: {type: n}}` sorted by type name for stable output.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/project/errors.js';
import { countNodesByType } from '../../../src/tools/analysis/count_nodes_by_type.js';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-count-nodes-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function writeTscn(rel: string, contents: string): Promise<void> {
  const full = join(workspace, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, contents);
}

const SCENE_ONE = `[gd_scene load_steps=2 format=3]

[node name="Root" type="Node3D"]

[node name="Player" type="CharacterBody3D" parent="."]

[node name="Camera" type="Camera3D" parent="Player"]

[node name="Hitbox" type="Area3D" parent="Player"]
`;

const SCENE_TWO = `[gd_scene format=3]

[node name="World" type="Node3D"]

[node name="Enemy" type="CharacterBody3D" parent="."]
`;

const INHERITED_SCENE = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://parent.tscn" id="1"]

[node name="Child" parent="." instance=ExtResource("1")]
`;

describe('countNodesByType — happy path', () => {
  it('counts types across every .tscn file under the project root', async () => {
    await writeTscn('levels/a.tscn', SCENE_ONE);
    await writeTscn('levels/b.tscn', SCENE_TWO);
    const result = await countNodesByType({ projectRoot: workspace });
    expect(result.counts).toEqual({
      Area3D: 1,
      Camera3D: 1,
      CharacterBody3D: 2,
      Node3D: 2,
    });
  });

  it('scopes to `root` subdirectory when supplied', async () => {
    await writeTscn('levels/a.tscn', SCENE_ONE);
    await writeTscn('other/b.tscn', SCENE_TWO);
    const result = await countNodesByType({
      projectRoot: workspace,
      root: 'levels',
    });
    expect(result.counts).toEqual({
      Area3D: 1,
      Camera3D: 1,
      CharacterBody3D: 1,
      Node3D: 1,
    });
  });

  it('counts nodes without a type= attribute under the "<instance>" bucket', async () => {
    await writeTscn('scenes/i.tscn', INHERITED_SCENE);
    const result = await countNodesByType({ projectRoot: workspace });
    expect(result.counts['<instance>']).toBe(1);
  });

  it('returns an empty counts object when no scenes are present', async () => {
    const result = await countNodesByType({ projectRoot: workspace });
    expect(result.counts).toEqual({});
  });
});

describe('countNodesByType — default skipped directories', () => {
  it('skips .git, .godot, node_modules, dist', async () => {
    await writeTscn('.git/x.tscn', SCENE_ONE);
    await writeTscn('.godot/y.tscn', SCENE_ONE);
    await writeTscn('node_modules/pkg/z.tscn', SCENE_ONE);
    await writeTscn('mcp-server/dist/w.tscn', SCENE_ONE);
    await writeTscn('levels/a.tscn', SCENE_TWO);
    const result = await countNodesByType({ projectRoot: workspace });
    expect(result.counts).toEqual({
      CharacterBody3D: 1,
      Node3D: 1,
    });
  });
});

describe('countNodesByType — validation', () => {
  it('rejects an empty projectRoot', async () => {
    await expect(countNodesByType({ projectRoot: '' })).rejects.toThrow(
      ToolInputError,
    );
  });

  it('rejects a `root` that escapes the project with "../"', async () => {
    await expect(
      countNodesByType({ projectRoot: workspace, root: '../other' }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an absolute `root`', async () => {
    await expect(
      countNodesByType({ projectRoot: workspace, root: '/etc' }),
    ).rejects.toThrow(ToolInputError);
  });
});
