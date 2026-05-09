#!/usr/bin/env node
/**
 * Context Commits enforcer used as a Git `pre-commit` hook.
 *
 * Purpose:
 *   When a commit touches a file mapped in `.forgekit/context-map.json`, the
 *   hook verifies that the mapped anchor section(s) in `CLAUDE.md` /
 *   `.cursorrules` are updated in the SAME commit. If not, the commit is
 *   rejected with `CONTEXT_FILE_STALE` (JSON-RPC error code `-32012`).
 *
 * Skip semantics:
 *   `git commit --no-verify` bypasses Git hooks entirely by design, so the
 *   hook is never invoked and cannot log the skip itself. For explicit,
 *   tracked skips (e.g. triggered by ForgeKit tooling) the hook honours a
 *   `FORGEKIT_SKIP=1` environment variable: it records a JSON line in
 *   `.git/hooks/context-commit-skips.log` with the fields `{ts, author,
 *   files, reason}` and exits zero.
 *
 * The module exports pure helpers (`matchesGlob`, `findRequiredAnchors`,
 * `anchorWasTouched`) plus a dependency-injected `runHook` driver, so tests
 * never spawn real Git or touch the real filesystem.
 */

import { appendFile as nodeAppendFile, readFile as nodeReadFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** JSON-RPC error code emitted when a context-file anchor is stale. */
export const ERROR_CODE_CONTEXT_FILE_STALE = -32012 as const;

/** JSON-RPC error message emitted when a context-file anchor is stale. */
export const ERROR_MESSAGE_CONTEXT_FILE_STALE = 'CONTEXT_FILE_STALE' as const;

/** A single entry in `.forgekit/context-map.json`. */
export interface ContextMapping {
  /**
   * Glob pattern describing code files that trigger this mapping. Supports
   * `*` (single segment), `**` (multiple segments) and literal path segments.
   */
  pattern: string;
  /**
   * Anchors (of the form `<path>#<heading-slug>`) that must be updated in the
   * same commit as the matching code file.
   */
  anchors: readonly string[];
}

/** Parsed `.forgekit/context-map.json` file. */
export interface ContextMap {
  version: 1;
  mappings: readonly ContextMapping[];
  description?: string;
}

/** Minimal I/O surface needed by {@link runHook}. Injected in tests. */
export interface HookIo {
  exec: (cmd: string, args: readonly string[]) => Promise<string>;
  readFile: (path: string) => Promise<string>;
  writeStderr: (chunk: string) => void;
  exit: (code: number) => void;
  appendFile: (path: string, chunk: string) => Promise<void>;
  now: () => Date;
  env: Readonly<Record<string, string | undefined>>;
}

/** A single stale anchor surfaced in `data.stale_anchors`. */
export interface StaleAnchor {
  code_file: string;
  required_anchor: string;
}

/**
 * Compile a glob pattern into an anchored regular expression.
 *
 * Supported syntax (deliberately minimal, zero-dependency):
 *   - `**` matches zero or more path segments (including empty).
 *   - `*`  matches any characters that are not path separators.
 *   - Any other character is a literal, with regex metacharacters escaped.
 */
function globToRegex(pattern: string): RegExp {
  let source = '^';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      const nextIsSlash = pattern[i + 2] === '/';
      if (nextIsSlash) {
        // `**/` → match zero or more path segments followed by a `/`.
        source += '(?:.*/)?';
        i += 3;
      } else {
        // `**` at end of pattern → match one or more characters (any).
        source += '.+';
        i += 2;
      }
      continue;
    }
    if (ch === '*') {
      source += '[^/]*';
      i += 1;
      continue;
    }
    if ('\\^$.|?+(){}[]'.includes(ch)) {
      source += `\\${ch}`;
    } else {
      source += ch;
    }
    i += 1;
  }
  source += '$';
  return new RegExp(source);
}

/**
 * Return `true` when `file` matches the glob `pattern` described in
 * {@link globToRegex}.
 */
export function matchesGlob(file: string, pattern: string): boolean {
  return globToRegex(pattern).test(file);
}

/**
 * Enumerate every `(code_file, required_anchor)` pair implied by the set of
 * staged files and the context map. A code file is included once per anchor
 * of every mapping it matches.
 */
export function findRequiredAnchors(
  stagedFiles: readonly string[],
  contextMap: ContextMap,
): ReadonlyArray<StaleAnchor> {
  const out: StaleAnchor[] = [];
  for (const file of stagedFiles) {
    for (const mapping of contextMap.mappings) {
      if (matchesGlob(file, mapping.pattern)) {
        for (const anchor of mapping.anchors) {
          out.push({ code_file: file, required_anchor: anchor });
        }
      }
    }
  }
  return out;
}

/**
 * Convert a markdown heading label (text after `# `) into the slug used in
 * anchor references. Matches GitHub's common behaviour closely enough for
 * our internal use: lowercase, non-alphanumerics replaced with `-`, trimmed.
 */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Parse a unified diff and decide whether a hunk touches the section under
 * the heading whose slug equals `headingId`. A "section" runs from its
 * heading to the next heading of the same or lower depth.
 *
 * Strategy: walk the diff line-by-line, track the most recent heading seen
 * in context / added lines, and when we encounter a change line (`+` or
 * `-`) assume the currently-open section is being touched.
 */
export function anchorWasTouched(diffText: string, headingId: string): boolean {
  if (diffText.length === 0) {
    return false;
  }
  let currentSlug: string | null = null;
  let inHunk = false;
  for (const rawLine of diffText.split(/\r?\n/)) {
    if (rawLine.startsWith('@@')) {
      inHunk = true;
      currentSlug = null;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    // Strip the leading ' ', '+' or '-' marker for content inspection.
    const marker = rawLine[0] ?? '';
    const content = rawLine.slice(1);
    const headingMatch = /^(#+)\s+(.+?)\s*$/.exec(content);
    if (headingMatch !== null) {
      currentSlug = slugify(headingMatch[2]);
      // The heading line itself being added counts as touching the section.
      if ((marker === '+' || marker === '-') && currentSlug === headingId) {
        return true;
      }
      continue;
    }
    if ((marker === '+' || marker === '-') && currentSlug === headingId) {
      return true;
    }
  }
  return false;
}

/**
 * Parse an anchor of the form `<path>#<slug>` into its two components.
 */
function splitAnchor(anchor: string): { file: string; slug: string } {
  const hashIdx = anchor.indexOf('#');
  if (hashIdx < 0) {
    return { file: anchor, slug: '' };
  }
  return {
    file: anchor.slice(0, hashIdx),
    slug: anchor.slice(hashIdx + 1),
  };
}

/**
 * Build the JSON-RPC error object emitted on rejection.
 */
function buildStaleError(staleAnchors: readonly StaleAnchor[]): string {
  const payload = {
    jsonrpc: '2.0',
    error: {
      code: ERROR_CODE_CONTEXT_FILE_STALE,
      message: ERROR_MESSAGE_CONTEXT_FILE_STALE,
      data: {
        stale_anchors: staleAnchors,
      },
    },
  };
  return JSON.stringify(payload);
}

/**
 * Record a skip event in `.git/hooks/context-commit-skips.log` and expose the
 * helper for programmatic use by future ForgeKit CLI commands.
 */
export async function recordSkip(
  io: Pick<HookIo, 'appendFile' | 'now'>,
  logPath: string,
  entry: { author: string; files: readonly string[]; reason: string },
): Promise<void> {
  const line = JSON.stringify({
    ts: io.now().toISOString(),
    author: entry.author,
    files: entry.files,
    reason: entry.reason,
  });
  await io.appendFile(logPath, `${line}\n`);
}

async function readStagedFiles(io: HookIo): Promise<readonly string[]> {
  const out = await io.exec('git', ['diff', '--cached', '--name-only', '-z']);
  return out
    .split('\0')
    .map((entry) => entry.replace(/\r?\n$/, ''))
    .filter((entry) => entry.length > 0);
}

async function readRepoRoot(io: HookIo): Promise<string> {
  const out = await io.exec('git', ['rev-parse', '--show-toplevel']);
  return out.trim();
}

async function readAuthor(io: HookIo): Promise<string> {
  try {
    const out = await io.exec('git', ['config', 'user.name']);
    const name = out.trim();
    return name.length > 0 ? name : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function readDiffForFile(io: HookIo, file: string): Promise<string> {
  try {
    return await io.exec('git', [
      'diff',
      '--cached',
      '-U0',
      '--',
      file,
    ]);
  } catch {
    return '';
  }
}

/**
 * End-to-end driver for the pre-commit hook. See file header for behaviour.
 */
export async function runHook(io: HookIo): Promise<void> {
  const repoRoot = await readRepoRoot(io);
  const stagedFiles = await readStagedFiles(io);

  // Handle explicit skip requests first so the skip log is always written.
  if (io.env.FORGEKIT_SKIP === '1') {
    const author = await readAuthor(io);
    const reason = io.env.FORGEKIT_SKIP_REASON ?? 'unspecified';
    await recordSkip(io, `${repoRoot}/.git/hooks/context-commit-skips.log`, {
      author,
      files: stagedFiles,
      reason,
    });
    io.exit(0);
    return;
  }

  let contextMapRaw: string;
  try {
    contextMapRaw = await io.readFile(`${repoRoot}/.forgekit/context-map.json`);
  } catch {
    // No context map → nothing to enforce.
    io.exit(0);
    return;
  }

  let contextMap: ContextMap;
  try {
    contextMap = JSON.parse(contextMapRaw) as ContextMap;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.writeStderr(
      `[@forgekitstudio/core-mcp] pre-commit: could not parse .forgekit/context-map.json: ${message}\n`,
    );
    io.exit(1);
    return;
  }

  const required = findRequiredAnchors(stagedFiles, contextMap);
  if (required.length === 0) {
    io.exit(0);
    return;
  }

  // Cache the diff for every anchor file so we only ask Git once per file.
  const diffCache = new Map<string, string>();
  const stale: StaleAnchor[] = [];
  for (const entry of required) {
    const { file: anchorFile, slug } = splitAnchor(entry.required_anchor);
    if (!stagedFiles.includes(anchorFile)) {
      stale.push(entry);
      continue;
    }
    let diff = diffCache.get(anchorFile);
    if (diff === undefined) {
      diff = await readDiffForFile(io, anchorFile);
      diffCache.set(anchorFile, diff);
    }
    if (!anchorWasTouched(diff, slug)) {
      stale.push(entry);
    }
  }

  if (stale.length > 0) {
    io.writeStderr(
      '[@forgekitstudio/core-mcp] pre-commit rejected the commit — context files are stale. Details:\n',
    );
    io.writeStderr(`${buildStaleError(stale)}\n`);
    io.exit(1);
    return;
  }

  io.exit(0);
}

/** `true` when this module is executed directly by Node (not imported). */
function isInvokedDirectly(): boolean {
  return (
    typeof process !== 'undefined' &&
    Array.isArray(process.argv) &&
    process.argv[1] !== undefined &&
    import.meta.url === `file://${process.argv[1]}`
  );
}

if (isInvokedDirectly()) {
  const io: HookIo = {
    exec: async (cmd, args) => {
      const { stdout } = await execFileAsync(cmd, [...args], {
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout.toString();
    },
    readFile: async (path) => nodeReadFile(path, 'utf8'),
    writeStderr: (chunk) => process.stderr.write(chunk),
    exit: (code) => process.exit(code),
    appendFile: async (path, chunk) => nodeAppendFile(path, chunk, 'utf8'),
    now: () => new Date(),
    env: process.env,
  };
  runHook(io).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[@forgekitstudio/core-mcp] pre-commit hook crashed: ${message}\n`,
    );
    process.exit(1);
  });
}
