/**
 * Tests for the `analysis.dependency_graph` MCP tool.
 *
 * Builds a static dependency graph of every `.gd` file under `projectRoot`
 * (or under `<projectRoot>/<root>/` when `root` is supplied). Edges are
 * extracted from `preload("res://...")`, `load("res://...")`, and
 * `extends "res://..."` — the same reference patterns consumed by
 * `project.check_imports`.
 *
 * Node ids are project-relative paths with forward slashes. The tool
 * exports in two formats:
 *
 *   - `"json"` (default): `{nodes: [{id}], edges: [{from, to}]}` —
 *     Structured output consumable by AI agents and visualizer clients.
 *   - `"dot"`: Graphviz source (`digraph forgekit { "a.gd" -> "b.gd"; }`)
 *     that renders to an SVG via the Graphviz CLI.
 *
 * Edges that point to files outside the scan set (e.g. Godot engine
 * resources) are dropped — the graph only contains nodes we actually
 * saw on disk so the output is self-contained.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/project/errors.js';
import {
  dependencyGraph,
  type DependencyGraphJson,
  type DependencyGraphDot,
} from '../../../src/tools/analysis/dependency_graph.js';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-depgraph-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function writeGd(rel: string, contents: string): Promise<void> {
  const full = join(workspace, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, contents);
}

describe('dependencyGraph — JSON format (default)', () => {
  it('returns nodes for every .gd file and edges for every preload/load/extends', async () => {
    await writeGd(
      'addons/forgekit_core/a.gd',
      'extends Node\nvar x = preload("res://addons/forgekit_core/b.gd")\n',
    );
    await writeGd('addons/forgekit_core/b.gd', 'extends Node\n');
    const result = (await dependencyGraph({
      projectRoot: workspace,
    })) as DependencyGraphJson;
    expect(result.nodes.map((n) => n.id).sort()).toEqual([
      'addons/forgekit_core/a.gd',
      'addons/forgekit_core/b.gd',
    ]);
    expect(result.edges).toEqual([
      {
        from: 'addons/forgekit_core/a.gd',
        to: 'addons/forgekit_core/b.gd',
      },
    ]);
  });

  it('captures all three reference patterns (preload, load, extends)', async () => {
    await writeGd('a.gd', 'var x = preload("res://b.gd")\n');
    await writeGd('b.gd', 'var y = load("res://c.gd")\n');
    await writeGd('c.gd', 'extends "res://d.gd"\n');
    await writeGd('d.gd', '');
    const result = (await dependencyGraph({
      projectRoot: workspace,
    })) as DependencyGraphJson;
    const edges = result.edges
      .map((e) => `${e.from}->${e.to}`)
      .sort();
    expect(edges).toEqual([
      'a.gd->b.gd',
      'b.gd->c.gd',
      'c.gd->d.gd',
    ]);
  });

  it('deduplicates repeated edges inside one file', async () => {
    await writeGd(
      'a.gd',
      [
        'var x = preload("res://b.gd")',
        'var y = preload("res://b.gd")',
        'var z = load("res://b.gd")',
        '',
      ].join('\n'),
    );
    await writeGd('b.gd', '');
    const result = (await dependencyGraph({
      projectRoot: workspace,
    })) as DependencyGraphJson;
    expect(result.edges).toEqual([{ from: 'a.gd', to: 'b.gd' }]);
  });

  it('drops edges that point to files outside the scan set', async () => {
    await writeGd(
      'a.gd',
      'var x = preload("res://addons/gut/gut_cmdln.gd")\nvar y = preload("res://b.gd")\n',
    );
    await writeGd('b.gd', '');
    const result = (await dependencyGraph({
      projectRoot: workspace,
    })) as DependencyGraphJson;
    expect(result.edges).toEqual([{ from: 'a.gd', to: 'b.gd' }]);
  });

  it('scopes to the `root` subdirectory when supplied', async () => {
    await writeGd(
      'addons/forgekit_core/a.gd',
      'var x = preload("res://addons/forgekit_core/b.gd")\n',
    );
    await writeGd('addons/forgekit_core/b.gd', '');
    await writeGd('outside/c.gd', 'var x = preload("res://outside/d.gd")\n');
    await writeGd('outside/d.gd', '');
    const result = (await dependencyGraph({
      projectRoot: workspace,
      root: 'addons/forgekit_core',
    })) as DependencyGraphJson;
    expect(result.nodes.map((n) => n.id).sort()).toEqual([
      'addons/forgekit_core/a.gd',
      'addons/forgekit_core/b.gd',
    ]);
  });
});

describe('dependencyGraph — DOT format', () => {
  it('emits Graphviz digraph source when format="dot"', async () => {
    await writeGd('a.gd', 'var x = preload("res://b.gd")\n');
    await writeGd('b.gd', '');
    const result = (await dependencyGraph({
      projectRoot: workspace,
      format: 'dot',
    })) as DependencyGraphDot;
    expect(result.dot).toMatch(/^digraph forgekit\s*\{/);
    expect(result.dot).toContain('"a.gd"');
    expect(result.dot).toContain('"b.gd"');
    expect(result.dot).toContain('"a.gd" -> "b.gd";');
    expect(result.dot.trim().endsWith('}')).toBe(true);
  });

  it('emits every discovered node even when it has no edges', async () => {
    await writeGd('lonely.gd', 'extends Node\n');
    const result = (await dependencyGraph({
      projectRoot: workspace,
      format: 'dot',
    })) as DependencyGraphDot;
    expect(result.dot).toContain('"lonely.gd";');
  });
});

describe('dependencyGraph — default skipped directories', () => {
  it('skips .git, .godot, node_modules, dist', async () => {
    await writeGd('.git/a.gd', '');
    await writeGd('.godot/b.gd', '');
    await writeGd('node_modules/pkg/c.gd', '');
    await writeGd('mcp-server/dist/d.gd', '');
    await writeGd('addons/real.gd', '');
    const result = (await dependencyGraph({
      projectRoot: workspace,
    })) as DependencyGraphJson;
    expect(result.nodes.map((n) => n.id)).toEqual(['addons/real.gd']);
  });
});

describe('dependencyGraph — validation', () => {
  it('rejects an empty projectRoot', async () => {
    await expect(dependencyGraph({ projectRoot: '' })).rejects.toThrow(
      ToolInputError,
    );
  });

  it('rejects an invalid format value', async () => {
    await expect(
      // @ts-expect-error — intentional invalid value for the validation test
      dependencyGraph({ projectRoot: workspace, format: 'svg' }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects a `root` that escapes the project with "../"', async () => {
    await expect(
      dependencyGraph({ projectRoot: workspace, root: '../escape' }),
    ).rejects.toThrow(ToolInputError);
  });
});
