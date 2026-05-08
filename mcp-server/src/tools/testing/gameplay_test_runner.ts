/**
 * `Gameplay_Test_Runner` — MCP-server-side driver for end-to-end gameplay
 * scenarios.
 *
 * Spawns Godot headless with the runtime bridge flag (`--mcp-bridge`)
 * and the target scene passed as `--scene=<path>`. An optional ordered
 * list of step identifiers is serialized as a single JSON argv element
 * (`--mcp-bridge-steps=<json>`), so the scene script can read them via
 * `OS.get_cmdline_args()` without further parsing. No shell is ever
 * involved, so scene paths and step names can contain any character that
 * is legal in a Godot resource path.
 *
 * The spawned process is expected to print a single line of JSON matching
 * the TestReport schema on stdout. When no such line exists the runner
 * falls back to a synthetic failed TestReport so the self-healing loop
 * always receives a well-formed result.
 *
 * Every returned TestReport is post-processed to guarantee a non-empty
 * `run_id`, a parseable ISO 8601 `timestamp`, at least one entry in
 * `tests[]`, and — on the synthetic-failure path — a `failure_message`
 * that carries both the captured stderr and the non-zero exit code.
 *
 * The `tests.run_gameplay` MCP tool (see `run_gameplay.ts`) is a thin
 * shim over `runGameplayScenario`.
 */

import { randomBytes } from 'node:crypto';

import { ToolInputError } from './errors.js';
import {
  extractReportFromStdout,
  syntheticFailureReport,
} from './report_extractor.js';
import { defaultSpawnGodot, type SpawnGodot } from './spawn_godot.js';
import type { TestReport } from './test_report.js';

export interface GameplayScenario {
  /** `res://` path to the scene file that drives the scenario. */
  scene_path: string;
  /** Optional ordered list of step identifiers passed to the scene. */
  steps?: readonly string[];
}

export interface RunGameplayScenarioDeps {
  spawn?: SpawnGodot;
}

function requireNonBlank(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

function validateSteps(steps: readonly string[]): void {
  steps.forEach((step, i) => {
    if (typeof step !== 'string' || step.trim() === '') {
      throw new ToolInputError(
        `"steps[${i}]" must be a non-empty string (got ${JSON.stringify(step)}).`,
      );
    }
  });
}

/**
 * Generates a short, unique id for one gameplay run. The timestamp prefix
 * keeps ids sortable; the random suffix guarantees uniqueness even when
 * two runs land in the same millisecond.
 */
function generateRunId(): string {
  return `gp-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

/**
 * Enriches a TestReport so it always satisfies the run envelope contract:
 * non-empty `run_id`, ISO 8601 `timestamp`, at least one test entry, and
 * — on the synthetic-failure path — a `failure_message` that includes
 * both the captured stderr and the non-zero exit code.
 *
 * Values coming from a well-formed stdout report are preserved; only
 * missing fields are filled in.
 */
function enrichReport(
  report: TestReport,
  ctx: { scenePath: string; synthetic: boolean; stderr: string; exitCode: number },
): TestReport {
  const runId = report.run_id !== '' ? report.run_id : generateRunId();
  const timestamp =
    report.timestamp !== '' ? report.timestamp : new Date().toISOString();

  if (!ctx.synthetic) {
    return { ...report, run_id: runId, timestamp };
  }

  // Synthetic failure path: replace the placeholder "spawn" test with a
  // scene-specific entry and guarantee the exit code surfaces in the
  // failure message alongside any captured stderr.
  const stderrText = ctx.stderr.trim();
  const failureMessage =
    stderrText.length > 0
      ? `${stderrText} (godot exit code ${ctx.exitCode})`
      : `godot exited with code ${ctx.exitCode} and produced no TestReport`;
  const tests = [
    {
      name: `gameplay scenario ${ctx.scenePath}`,
      status: 'failed',
      duration_ms: 0,
      assertions: [],
      failure_message: failureMessage,
      stack_trace: '',
    },
  ];
  return { ...report, run_id: runId, timestamp, tests };
}

/**
 * Drives a single gameplay scenario and returns its TestReport.
 *
 * Input validation errors are raised as `ToolInputError`. Spawn failures
 * and malformed stdout are absorbed into a synthetic failed TestReport.
 */
export async function runGameplayScenario(
  scenario: GameplayScenario,
  deps: RunGameplayScenarioDeps = {},
): Promise<TestReport> {
  const scenePath = requireNonBlank(scenario.scene_path, 'scene_path');

  // The runtime bridge accepts the scene target via `--scene=<path>`.
  // Using the `=` form keeps the scene path in a single argv element so
  // paths with spaces or unusual characters do not need quoting.
  const args: string[] = ['--headless', '--mcp-bridge', `--scene=${scenePath}`];

  if (scenario.steps !== undefined && scenario.steps.length > 0) {
    validateSteps(scenario.steps);
    args.push(`--mcp-bridge-steps=${JSON.stringify(scenario.steps)}`);
  }

  const spawn = deps.spawn ?? defaultSpawnGodot;
  const { stdout, stderr, exitCode } = await spawn(args);

  const parsed = extractReportFromStdout(stdout);
  if (parsed !== null) {
    return enrichReport(parsed, {
      scenePath,
      synthetic: false,
      stderr,
      exitCode,
    });
  }
  const synthetic = syntheticFailureReport({ stderr, exitCode });
  return enrichReport(synthetic, {
    scenePath,
    synthetic: true,
    stderr,
    exitCode,
  });
}
