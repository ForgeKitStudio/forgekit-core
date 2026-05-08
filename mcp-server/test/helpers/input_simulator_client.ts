/**
 * Test-only helper that drives the Input_Simulator invariant through a
 * single batched headless Godot spawn.
 *
 * Property 30 is a statement about Godot engine state — "after
 * `simulate_action(a, pressed=p)`, `Input.is_action_pressed(a) === p`".
 * No pure-TypeScript shim can observe that: the input action state
 * machine lives inside the engine. We therefore follow the same
 * batching pattern as Property 14 (GDScript validator): collect every
 * fast-check sample into a JSON payload and dispatch it to the Godot
 * driver `tools/cli_runner/simulate_actions_batch.gd` in one spawn.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** One `(action, strength, pressed)` sample sent to the Godot driver. */
export interface InputSample {
  readonly action: string;
  readonly strength: number;
  readonly pressed: boolean;
}

/** Observed Godot state after `Input.parse_input_event(event)`. */
export interface InputObservation {
  readonly isActionPressed: boolean;
  readonly strength: number;
}

/** Envelope emitted by the Godot driver between the stdout markers. */
interface DriverEnvelope {
  readonly results: ReadonlyArray<{
    readonly is_action_pressed: boolean;
    readonly strength: number;
  }>;
  readonly error?: string;
}

/**
 * Walk upward from this file's directory to locate the project root —
 * the directory containing `project.godot`. Fails loudly instead of
 * silently returning `/` so a misplaced test does not turn into a flaky
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
  const beginTag = '<<<FORGEKIT_INPUT_BEGIN>>>';
  const endTag = '<<<FORGEKIT_INPUT_END>>>';
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
 * Dispatch every sample in `samples` in a single headless Godot run.
 * The returned array has one entry per input sample, in input order.
 */
export async function simulateActionBatch(
  samples: readonly InputSample[],
): Promise<InputObservation[]> {
  const projectRoot = findProjectRoot(HERE);
  const driverPath = 'tools/cli_runner/simulate_actions_batch.gd';
  const args: string[] = [
    '--headless',
    '--path',
    projectRoot,
    '--script',
    driverPath,
  ];
  const payload = JSON.stringify({ samples });
  const { stdout, stderr, exitCode } = await runGodot(
    projectRoot,
    args,
    payload,
  );
  if (exitCode !== 0) {
    throw new Error(
      `godot exited with code ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  const envelope = extractEnvelope(stdout);
  if (envelope.error !== undefined) {
    throw new Error(`driver reported error: ${envelope.error}`);
  }
  return envelope.results.map((r) => ({
    isActionPressed: r.is_action_pressed,
    strength: r.strength,
  }));
}
