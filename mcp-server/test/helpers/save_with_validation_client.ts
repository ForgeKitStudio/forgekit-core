/**
 * Test-only helper that drives `McpScriptWriter.write` (the headless half
 * of `gdscript.save_with_validation`) through a single headless Godot
 * run so the TypeScript property test can issue 100 cases per sweep
 * without spawning one Godot process per sample.
 *
 * The production tool is surfaced through
 * `addons/forgekit_core/mcp/editor_plugin/tools/script_tools.gd`. The
 * write path itself — validate → boundary check → atomic write → reload
 * — lives in `McpScriptWriter` and is what this property exercises.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** One case fed into the Godot driver. */
export interface SaveCase {
  /** Absolute Godot-style path (`user://...` is expected). */
  readonly path: string;
  /** GDScript source to pass to `save_with_validation`. */
  readonly source: string;
  /**
   * Optional bytes that should exist at `path` before the write runs.
   * When `null`, the driver makes sure the file does not exist before
   * invoking the writer.
   */
  readonly preExisting: string | null;
}

/** One record per case, in input order. */
export interface SaveResult {
  readonly validateOk: boolean;
  readonly written: boolean;
  readonly existsAfter: boolean;
  readonly contentAfter: string;
  readonly errorCode?: number;
  readonly errorMessage?: string;
}

interface RawDriverRecord {
  readonly validate_ok: boolean;
  readonly written: boolean;
  readonly exists_after: boolean;
  readonly content_after: string;
  readonly error_code?: number;
  readonly error_message?: string;
}

interface RawDriverEnvelope {
  readonly results: ReadonlyArray<RawDriverRecord>;
  readonly error?: string;
}

/**
 * Walk upward from the current test file to find the project root — the
 * directory that contains `project.godot`.
 */
function findProjectRoot(startDir: string): string {
  let cur = startDir;
  for (let i = 0; i < 16; i++) {
    if (existsSync(resolve(cur, 'project.godot'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(`could not find project.godot walking up from ${startDir}`);
}

function godotBinary(): string {
  const fromEnv = process.env.GODOT_BIN;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return 'godot';
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runGodot(
  cwd: string,
  args: readonly string[],
  payload: string,
): Promise<SpawnResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(godotBinary(), [...args], {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => rejectPromise(err));
    child.on('close', (code) => {
      resolvePromise({ stdout, stderr, exitCode: code ?? -1 });
    });

    child.stdin.end(payload, 'utf8');
  });
}

function extractEnvelope(stdout: string): RawDriverEnvelope {
  const beginTag = '<<<FORGEKIT_SAVE_BEGIN>>>';
  const endTag = '<<<FORGEKIT_SAVE_END>>>';
  const beginIdx = stdout.indexOf(beginTag);
  const endIdx = stdout.indexOf(endTag);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    throw new Error(
      `driver did not emit fenced envelope; stdout was:\n${stdout}`,
    );
  }
  const body = stdout.slice(beginIdx + beginTag.length, endIdx).trim();
  const parsed = JSON.parse(body) as RawDriverEnvelope;
  if (!Array.isArray(parsed.results)) {
    throw new Error(`driver envelope missing results[]: ${body}`);
  }
  return parsed;
}

/**
 * Drive every case in `cases` through `McpScriptWriter.write` in a
 * single headless Godot run and return the per-case observations in
 * input order.
 */
export async function runSaveWithValidationBatch(
  cases: readonly SaveCase[],
): Promise<SaveResult[]> {
  const projectRoot = findProjectRoot(HERE);
  const driverPath = 'tools/cli_runner/save_with_validation_batch.gd';
  const args: string[] = [
    '--headless',
    '--path',
    projectRoot,
    '--script',
    driverPath,
  ];
  const payload = JSON.stringify({
    cases: cases.map((c) => ({
      path: c.path,
      source: c.source,
      pre_existing: c.preExisting,
    })),
  });
  const { stdout, stderr, exitCode } = await runGodot(projectRoot, args, payload);
  if (exitCode !== 0) {
    throw new Error(
      `godot exited with code ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  const envelope = extractEnvelope(stdout);
  if (envelope.error !== undefined) {
    throw new Error(`driver reported error: ${envelope.error}`);
  }
  return envelope.results.map((r) => {
    const out: SaveResult = {
      validateOk: r.validate_ok,
      written: r.written,
      existsAfter: r.exists_after,
      contentAfter: r.content_after,
      ...(r.error_code !== undefined ? { errorCode: r.error_code } : {}),
      ...(r.error_message !== undefined ? { errorMessage: r.error_message } : {}),
    };
    return out;
  });
}
