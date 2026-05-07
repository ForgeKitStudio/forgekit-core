/**
 * Implementation of the `search.code` MCP tool.
 *
 * Walks every file under `projectRoot` (honoring optional `include` /
 * `exclude` prefix filters), runs the caller's regex against each line,
 * and returns `{matches: [{file, line, preview}]}` for every line that
 * matches. The regex is compiled with the `m` flag so `^`/`$` anchor
 * per line; callers who want to match across line boundaries need to
 * embed `\n` in their pattern explicitly.
 *
 * Long lines are truncated to 200 characters in `preview` to keep JSON
 * payloads compact — agents that need the full line can re-read the
 * file with `resource.load` using the returned `(file, line)` tuple.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ToolInputError } from '../project/errors.js';
import { walkProjectFiles } from './fs_walker.js';

/** Max length of the `preview` string emitted per match. */
const PREVIEW_MAX_LENGTH = 200;

export interface SearchCodeParams {
  /** Absolute path to the project root. */
  projectRoot: string;
  /**
   * JavaScript regex source string (no flags). Compiled with the `m`
   * flag so anchors work per line.
   */
  query: string;
  /**
   * Optional list of project-relative path prefixes (forward slashes).
   * When supplied, only files whose relative path starts with one of
   * these prefixes are scanned.
   */
  include?: ReadonlyArray<string>;
  /**
   * Optional list of project-relative path prefixes to skip. Exclude
   * wins over include when a path matches both.
   */
  exclude?: ReadonlyArray<string>;
}

export interface SearchCodeMatch {
  /** Project-relative POSIX path of the file. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /**
   * The full line with trailing newline stripped, truncated to
   * {@link PREVIEW_MAX_LENGTH} characters.
   */
  preview: string;
}

export interface SearchCodeResult {
  matches: SearchCodeMatch[];
}

export async function searchCode(
  params: SearchCodeParams,
): Promise<SearchCodeResult> {
  requireNonBlankString(params.projectRoot, 'projectRoot');
  requireNonBlankString(params.query, 'query');

  let re: RegExp;
  try {
    re = new RegExp(params.query, 'm');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ToolInputError(
      `"query" is not a valid regular expression: ${reason}`,
    );
  }

  const include = params.include ?? [];
  const exclude = params.exclude ?? [];

  const files = await walkProjectFiles({
    projectRoot: params.projectRoot,
    extensions: [],
  });

  const matches: SearchCodeMatch[] = [];
  for (const relPath of files) {
    if (!isIncluded(relPath, include)) continue;
    if (isExcluded(relPath, exclude)) continue;

    const full = join(params.projectRoot, relPath);
    let text: string;
    try {
      text = await readFile(full, 'utf8');
    } catch {
      continue;
    }

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // Empty trailing line produced by a final newline is never a
      // match for non-empty queries — skip it to avoid noise.
      if (lines[i] === '' && i === lines.length - 1) continue;
      if (re.test(lines[i])) {
        matches.push({
          file: relPath,
          line: i + 1,
          preview: truncate(lines[i], PREVIEW_MAX_LENGTH),
        });
      }
    }
  }

  return { matches };
}

function isIncluded(
  relPath: string,
  include: ReadonlyArray<string>,
): boolean {
  if (include.length === 0) return true;
  return include.some((prefix) => relPath.startsWith(prefix));
}

function isExcluded(
  relPath: string,
  exclude: ReadonlyArray<string>,
): boolean {
  return exclude.some((prefix) => relPath.startsWith(prefix));
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
