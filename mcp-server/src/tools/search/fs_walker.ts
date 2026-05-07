/**
 * Shared filesystem walker for the Analysis / Search tool family.
 *
 * Walks a project tree rooted at `<projectRoot>/<subdir>` and yields every
 * file whose extension is in `extensions`. The walker unconditionally
 * skips the Godot / Node.js metadata directories that never contain
 * source of interest (`.git/`, `.godot/`, `node_modules/`, `dist/`) so
 * every scanning tool gets the same defaults without duplicating the
 * skip list.
 *
 * Paths are returned project-relative with forward slashes so downstream
 * tools (search.code, analysis.dependency_graph, ...) can use them as
 * stable keys in their results without worrying about platform
 * separators.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** Directories that are never interesting to a static analyzer. */
const DEFAULT_SKIP_DIRS: ReadonlyArray<string> = [
  '.git',
  '.godot',
  'node_modules',
  'dist',
];

export interface WalkOptions {
  /** Absolute path to the project root. */
  projectRoot: string;
  /**
   * Optional project-relative subdirectory to scope the scan under.
   * When omitted, the full project is scanned.
   */
  subdir?: string;
  /**
   * File extensions to include, with the leading dot (e.g. `['.gd']`).
   * An empty list means "every file".
   */
  extensions: ReadonlyArray<string>;
}

/**
 * Walks the filesystem and returns project-relative POSIX paths.
 *
 * The walker silently tolerates unreadable directories (e.g. permission
 * errors on `.git/`) because analysis tools should degrade gracefully
 * rather than abort the whole scan over one inaccessible subtree.
 */
export async function walkProjectFiles(opts: WalkOptions): Promise<string[]> {
  const base = opts.subdir
    ? join(opts.projectRoot, opts.subdir)
    : opts.projectRoot;

  const out: string[] = [];
  await walk(base, opts.projectRoot, opts.extensions, out);
  out.sort();
  return out;
}

async function walk(
  current: string,
  projectRoot: string,
  extensions: ReadonlyArray<string>,
  out: string[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(current);
  } catch {
    return;
  }

  for (const name of entries) {
    if (DEFAULT_SKIP_DIRS.includes(name)) continue;

    const full = join(current, name);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }

    if (s.isDirectory()) {
      await walk(full, projectRoot, extensions, out);
      continue;
    }

    if (!s.isFile()) continue;

    if (extensions.length > 0) {
      if (!extensions.some((ext) => name.endsWith(ext))) continue;
    }

    out.push(toPosix(relative(projectRoot, full)));
  }
}

export function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}
