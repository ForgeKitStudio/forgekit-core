/**
 * Implementation of the `analysis.count_nodes_by_type` MCP tool.
 *
 * Walks every `.tscn` file under `projectRoot` (or under the optional
 * `root` subdirectory) and counts `[node ... type="..."]` headers by
 * their `type` attribute. Headers that lack `type=...` come from
 * inherited scenes (`[node ... instance=ExtResource(...)]`) and are
 * counted under the synthetic bucket `"<instance>"` so the total
 * reflects every node in the tree — losing them would make the output
 * disagree with Godot's own "Nodes" count in the editor.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ToolInputError } from '../project/errors.js';
import { walkProjectFiles } from '../search/fs_walker.js';

/** Bucket for nodes that come from an `[ext_resource]` instantiation. */
const INSTANCE_BUCKET = '<instance>';

export interface CountNodesByTypeParams {
  /** Absolute path to the Godot project root. */
  projectRoot: string;
  /**
   * Optional project-relative subdirectory to scope the scan. Must not
   * start with `/` and must not contain `..` — the tool refuses paths
   * that escape the project root.
   */
  root?: string;
}

export interface CountNodesByTypeResult {
  /** Sorted map from type name to occurrence count. */
  counts: Record<string, number>;
}

// Captures the `[node ...]` header — NOT the whole block. GDScript
// scene headers can wrap onto one logical line; Godot's own saver
// always emits them on a single physical line, so the single-line
// regex is sufficient for every file we'll see.
const NODE_HEADER_PATTERN = /\[node\b([^\]]*)\]/g;
const TYPE_ATTR_PATTERN = /\btype\s*=\s*"([^"]+)"/;

export async function countNodesByType(
  params: CountNodesByTypeParams,
): Promise<CountNodesByTypeResult> {
  requireNonBlankString(params.projectRoot, 'projectRoot');
  const subdir = validateRoot(params.root);

  const files = await walkProjectFiles({
    projectRoot: params.projectRoot,
    subdir,
    extensions: ['.tscn'],
  });

  const counts: Record<string, number> = {};
  for (const relPath of files) {
    const full = join(params.projectRoot, relPath);
    let text: string;
    try {
      text = await readFile(full, 'utf8');
    } catch {
      continue;
    }

    NODE_HEADER_PATTERN.lastIndex = 0;
    for (const header of text.matchAll(NODE_HEADER_PATTERN)) {
      const attrs = header[1];
      const typeMatch = TYPE_ATTR_PATTERN.exec(attrs);
      const bucket = typeMatch ? typeMatch[1] : INSTANCE_BUCKET;
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
  }

  // Return a new object sorted by key for deterministic JSON.
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(counts).sort()) {
    sorted[key] = counts[key];
  }
  return { counts: sorted };
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

function requireNonBlankString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
}
