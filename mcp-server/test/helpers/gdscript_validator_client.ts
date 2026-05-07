/**
 * Test-only helper that drives the GDScript validator through Godot
 * headless in a single batched spawn.
 *
 * The production MCP surface for `gdscript.validate` runs in-process
 * inside the editor plugin / runtime bridge and is covered by the
 * GDScript-side unit tests in `tests/unit/test_gdscript_validator.gd`. The
 * TypeScript property test needs the same semantics but from a Node
 * process, and a fresh Godot spawn per `fast-check` sample would exceed
 * any reasonable test budget. This helper therefore pipes a JSON payload
 * of sources to the `tools/cli_runner/validate_gdscript_batch.gd` driver
 * once per call and returns an array of `{ok, line}` records.
 *
 * The driver logs per-entry stderr markers so we can recover the parse
 * line number that Godot 4.x only ever writes to stderr.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** One-line summary of a single source validation. */
export interface ValidationResult {
  readonly ok: boolean;
  /** 1-indexed parse line surfaced by the engine; omitted for valid source. */
  readonly line?: number;
}

/** Envelope shape emitted by the Godot driver between stdout markers. */
interface DriverEnvelope {
  readonly results: ReadonlyArray<{
    readonly ok: boolean;
    readonly errors: ReadonlyArray<unknown>;
  }>;
}

/**
 * Walk upward from the current test file to find the project root — the
 * directory that contains `project.godot`. Fails loudly instead of
 * silently returning `/` so a misplaced test doesn't turn into a flaky
 * Godot invocation.
 */
function findProjectRoot(startDir: string): string {
  let cur = startDir;
  for (let i = 0; i < 16; i++) {
    if (existsSync(resolve(cur, 'project.godot'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(
    `could not find project.godot walking up from ${startDir}`,
  );
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

function extractEnvelope(stdout: string): DriverEnvelope {
  const beginTag = '<<<FORGEKIT_VALIDATE_BEGIN>>>';
  const endTag = '<<<FORGEKIT_VALIDATE_END>>>';
  const beginIdx = stdout.indexOf(beginTag);
  const endIdx = stdout.indexOf(endTag);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    throw new Error(
      `driver did not emit fenced envelope; stdout was:\n${stdout}`,
    );
  }
  const body = stdout.slice(beginIdx + beginTag.length, endIdx).trim();
  const parsed = JSON.parse(body) as DriverEnvelope;
  if (!Array.isArray(parsed.results)) {
    throw new Error(`driver envelope missing results[]: ${body}`);
  }
  return parsed;
}

/**
 * Split the driver's stderr into per-entry slices using the
 * `<<<FORGEKIT_ENTRY_BEGIN:i>>>` / `<<<FORGEKIT_ENTRY_END:i>>>` fences,
 * and extract the first parser line number reported inside each slice.
 * The engine emits lines of the form
 * `gdscript://<hash>.gd:<line>` for every parse error, and we pick the
 * first match as the canonical location for that entry.
 */
function extractErrorLines(stderr: string, count: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array<number | undefined>(count);
  for (let i = 0; i < count; i++) {
    const beginTag = `<<<FORGEKIT_ENTRY_BEGIN:${i}>>>`;
    const endTag = `<<<FORGEKIT_ENTRY_END:${i}>>>`;
    const b = stderr.indexOf(beginTag);
    const e = stderr.indexOf(endTag);
    if (b === -1 || e === -1 || e <= b) {
      out[i] = undefined;
      continue;
    }
    const slice = stderr.slice(b + beginTag.length, e);
    const m = slice.match(/gdscript:\/\/[^:\s]+:(\d+)/);
    out[i] = m ? Number.parseInt(m[1], 10) : undefined;
  }
  return out;
}

/**
 * Validate every source in `sources` in a single headless Godot run. The
 * returned array has one entry per input, in input order. `line` is set
 * only when the engine reported a parse error and its location could be
 * recovered from the fenced stderr section.
 */
export async function validateGdscriptBatch(
  sources: readonly string[],
): Promise<ValidationResult[]> {
  const projectRoot = findProjectRoot(HERE);
  const driverPath = 'tools/cli_runner/validate_gdscript_batch.gd';
  const args: string[] = [
    '--headless',
    '--path',
    projectRoot,
    '--script',
    driverPath,
  ];
  const payload = JSON.stringify({ sources });
  const { stdout, stderr, exitCode } = await runGodot(projectRoot, args, payload);
  if (exitCode !== 0) {
    throw new Error(
      `godot exited with code ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  const envelope = extractEnvelope(stdout);
  const lines = extractErrorLines(stderr, envelope.results.length);
  return envelope.results.map((r, i) => {
    const out: ValidationResult = r.ok ? { ok: true } : { ok: false, line: lines[i] };
    return out;
  });
}
