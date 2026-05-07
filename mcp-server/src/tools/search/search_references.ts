/**
 * Implementation of the `search.references` MCP tool.
 *
 * Finds every usage of `symbol` across `.gd` files under `projectRoot`
 * and classifies each hit into one of three buckets:
 *
 *   - `"definition"`: a `class_name <symbol>`, `func <symbol>(`,
 *     `signal <symbol>(`, `var <symbol>` (+`:` / `=` / `<space>`), or
 *     `const <symbol>` declaration.
 *   - `"call"`: a call site `<symbol>(`.
 *   - `"reference"`: any other word-boundary hit.
 *
 * The optional `class` parameter restricts the scan to files that
 * declare `class_name <class>`. This is coarse on purpose — GDScript
 * scope analysis across files is out of reach without a language server
 * — but lets callers narrow common cases like "find usages of `add_item`
 * inside InventorySystem.gd".
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ToolInputError } from '../project/errors.js';
import { walkProjectFiles } from './fs_walker.js';

/** GDScript identifier syntax: `[A-Za-z_][A-Za-z0-9_]*`. */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Max length of the `preview` string emitted per match. */
const PREVIEW_MAX_LENGTH = 200;

export interface SearchReferencesParams {
  /** Absolute path to the project root. */
  projectRoot: string;
  /** The symbol to find. Must be a valid GDScript identifier. */
  symbol: string;
  /**
   * Optional class filter — when supplied, only files that contain
   * `class_name <class>` are scanned.
   */
  class?: string;
}

/** What kind of hit `line` represents. */
export type ReferenceContext = 'definition' | 'call' | 'reference';

export interface SymbolReference {
  /** Project-relative POSIX path. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** Trimmed line text (up to 200 chars). */
  preview: string;
  /** Classification of this hit. */
  context: ReferenceContext;
}

export interface SearchReferencesResult {
  refs: SymbolReference[];
}

export async function searchReferences(
  params: SearchReferencesParams,
): Promise<SearchReferencesResult> {
  requireNonBlankString(params.projectRoot, 'projectRoot');
  requireNonBlankString(params.symbol, 'symbol');
  if (!IDENTIFIER_PATTERN.test(params.symbol)) {
    throw new ToolInputError(
      `"symbol" must be a valid GDScript identifier (got ${JSON.stringify(params.symbol)}).`,
    );
  }

  const files = await walkProjectFiles({
    projectRoot: params.projectRoot,
    extensions: ['.gd'],
  });

  const escaped = escapeRegex(params.symbol);
  const wordBoundary = new RegExp(`\\b${escaped}\\b`);
  const definitionPattern = new RegExp(
    `^\\s*(?:class_name\\s+${escaped}\\b|func\\s+${escaped}\\s*\\(|signal\\s+${escaped}\\b|var\\s+${escaped}\\b|const\\s+${escaped}\\b)`,
  );
  const callPattern = new RegExp(`\\b${escaped}\\s*\\(`);

  const classFilter = params.class ?? '';
  const classFilterPattern =
    classFilter === ''
      ? null
      : new RegExp(`^\\s*class_name\\s+${escapeRegex(classFilter)}\\b`, 'm');

  const refs: SymbolReference[] = [];
  for (const relPath of files) {
    const full = join(params.projectRoot, relPath);
    let text: string;
    try {
      text = await readFile(full, 'utf8');
    } catch {
      continue;
    }

    if (classFilterPattern !== null && !classFilterPattern.test(text)) {
      continue;
    }

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!wordBoundary.test(line)) continue;

      let context: ReferenceContext = 'reference';
      if (definitionPattern.test(line)) {
        context = 'definition';
      } else if (callPattern.test(line)) {
        context = 'call';
      }

      refs.push({
        file: relPath,
        line: i + 1,
        preview: truncate(line, PREVIEW_MAX_LENGTH),
        context,
      });
    }
  }

  return { refs };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function requireNonBlankString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
}
