/**
 * Implementation of the `analysis.dependency_graph` MCP tool.
 *
 * Builds a static dependency graph of every `.gd` file under
 * `projectRoot` (or under the optional `root` subdirectory). Edges are
 * extracted from `preload("res://...")`, `load("res://...")`, and
 * `extends "res://..."` — the same reference patterns that
 * `project.check_imports` uses.
 *
 * The graph is self-contained: edges that point to files outside the
 * scanned set (engine resources, external addons not on disk) are
 * dropped. Node ids are project-relative POSIX paths.
 *
 * Export formats:
 *
 *   - `"json"` (default): `{nodes: [{id}], edges: [{from, to}]}`.
 *   - `"dot"`: `{dot: string}` — a Graphviz `digraph forgekit { ... }`
 *     source string that renders through the Graphviz CLI.
 *
 * Edges are deduplicated per (from, to) pair: repeated preloads from
 * the same source file produce a single edge.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ToolInputError } from '../project/errors.js';
import { walkProjectFiles } from '../search/fs_walker.js';

export type DependencyGraphFormat = 'json' | 'dot';

export interface DependencyGraphParams {
  /** Absolute path to the project root. */
  projectRoot: string;
  /**
   * Optional project-relative subdirectory. Must not start with `/` and
   * must not contain `..` — we refuse paths that escape the project.
   */
  root?: string;
  /** Export format. Defaults to `"json"`. */
  format?: DependencyGraphFormat;
}

export interface DependencyNode {
  id: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
}

export interface DependencyGraphJson {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export interface DependencyGraphDot {
  dot: string;
}

export type DependencyGraphResult =
  | DependencyGraphJson
  | DependencyGraphDot;

// preload("res://..."), load("res://..."), extends "res://..."
const IMPORT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bpreload\s*\(\s*["'](res:\/\/[^"']+)["']\s*\)/g,
  /\bload\s*\(\s*["'](res:\/\/[^"']+)["']\s*\)/g,
  /\bextends\s+["'](res:\/\/[^"']+)["']/g,
];

export async function dependencyGraph(
  params: DependencyGraphParams,
): Promise<DependencyGraphResult> {
  requireNonBlankString(params.projectRoot, 'projectRoot');
  const subdir = validateRoot(params.root);
  const format = validateFormat(params.format);

  const files = await walkProjectFiles({
    projectRoot: params.projectRoot,
    subdir,
    extensions: ['.gd'],
  });

  // Nodes are just the files we saw on disk. We only emit edges to
  // targets that are also in this set, so the graph is closed under its
  // own nodes.
  const nodeIds = new Set(files);

  const edgeKeys = new Set<string>();
  const edges: DependencyEdge[] = [];

  for (const relPath of files) {
    const full = join(params.projectRoot, relPath);
    let text: string;
    try {
      text = await readFile(full, 'utf8');
    } catch {
      continue;
    }

    for (const target of extractResImports(text)) {
      const targetRel = stripResPrefix(target);
      if (!nodeIds.has(targetRel)) continue;
      const key = `${relPath}\u0000${targetRel}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ from: relPath, to: targetRel });
    }
  }

  const nodes: DependencyNode[] = files.map((id) => ({ id }));
  edges.sort((a, b) =>
    a.from !== b.from ? a.from.localeCompare(b.from) : a.to.localeCompare(b.to),
  );

  if (format === 'dot') {
    return { dot: renderDot(nodes, edges) };
  }
  return { nodes, edges };
}

function extractResImports(text: string): string[] {
  const seen: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const target = match[1];
      if (!seen.includes(target)) seen.push(target);
    }
  }
  return seen;
}

function stripResPrefix(target: string): string {
  const prefix = 'res://';
  return target.startsWith(prefix) ? target.slice(prefix.length) : target;
}

function renderDot(
  nodes: ReadonlyArray<DependencyNode>,
  edges: ReadonlyArray<DependencyEdge>,
): string {
  const lines: string[] = ['digraph forgekit {'];
  for (const node of nodes) {
    lines.push(`  "${escapeDot(node.id)}";`);
  }
  for (const edge of edges) {
    lines.push(`  "${escapeDot(edge.from)}" -> "${escapeDot(edge.to)}";`);
  }
  lines.push('}');
  return lines.join('\n');
}

function escapeDot(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function validateRoot(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ToolInputError(
      `"root" must be a non-empty string when supplied (got ${JSON.stringify(raw)}).`,
    );
  }
  if (raw.startsWith('/')) {
    throw new ToolInputError(
      `"root" must be a project-relative path; got absolute path ${JSON.stringify(raw)}.`,
    );
  }
  const segments = raw.split(/[\\/]/);
  if (segments.some((seg) => seg === '..')) {
    throw new ToolInputError(
      `"root" must not escape the project root with "..".`,
    );
  }
  return raw;
}

function validateFormat(
  raw: DependencyGraphFormat | undefined,
): DependencyGraphFormat {
  if (raw === undefined) return 'json';
  if (raw !== 'json' && raw !== 'dot') {
    throw new ToolInputError(
      `"format" must be "json" or "dot" (got ${JSON.stringify(raw)}).`,
    );
  }
  return raw;
}

function requireNonBlankString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
}
