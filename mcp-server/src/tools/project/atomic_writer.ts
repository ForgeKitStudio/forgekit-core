/**
 * Atomic writer for `project.godot` and similar Godot text files.
 *
 * Sequence: open temp file → write bytes → fsync → rename over target.
 * On POSIX and Windows this guarantees the reader either sees the full
 * old contents or the full new contents — never a truncated file — even
 * if the process is killed mid-write. The temp file lives next to the
 * target so the rename stays on the same filesystem.
 *
 * The writer is deliberately tiny: it does not know about Godot syntax,
 * it only cares about crash safety. Callers (see `update_settings.ts`)
 * produce the final bytes by parsing, merging, and serializing the
 * Godot INI tree before calling this helper.
 */

import { open, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

import { enforceBoundary } from './core_boundary.js';

/**
 * Atomically replaces `targetPath` with `contents`. On failure after
 * the temp file exists, the temp file is removed before rethrowing so
 * we don't leave orphaned temp files behind.
 *
 * Before touching the file system the target is run through the Core
 * Boundary guard. Writes aimed at `addons/forgekit_core/` or
 * `addons/gut/` are rejected with a `CORE_BOUNDARY_VIOLATION` payload
 * (JSON-RPC code `-32002`) that the caller propagates to the client.
 */
export async function atomicWriteFile(
  targetPath: string,
  contents: string,
): Promise<void> {
  enforceBoundary(targetPath);
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  // Include the PID to make the temp unique per writer, which matters
  // if two processes race for the same file.
  const tempPath = join(dir, `.${base}.${process.pid}.tmp`);

  const fh = await open(tempPath, 'w');
  try {
    await fh.writeFile(contents, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }

  try {
    await rename(tempPath, targetPath);
  } catch (err) {
    // Clean up the orphan on rename failure.
    try {
      await unlink(tempPath);
    } catch {
      // Ignore: the caller will see the original error.
    }
    throw err;
  }
}
