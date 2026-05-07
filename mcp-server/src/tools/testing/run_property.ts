/**
 * Implementation of the `tests.run_property` MCP tool.
 *
 * Iterates a GUT test suite under the ForgeKit property-test harness.
 * Iteration count and seed are exposed to GDScript as environment
 * variables so generators can read them without argv parsing. A failing
 * run may surface a `counterexample` sibling field next to the standard
 * TestReport body; it is returned alongside the report rather than
 * embedded in it, because the canonical TestReport schema does not carry
 * a counterexample field.
 */

import { ToolInputError } from './errors.js';
import {
  extractReportFromStdout,
  syntheticFailureReport,
} from './report_extractor.js';
import { defaultSpawnGodot, type SpawnGodot } from './spawn_godot.js';
import type { TestReport } from './test_report.js';

export interface RunPropertyParams {
  path: string;
  iterations?: number;
  seed?: number;
}

export interface RunPropertyDeps {
  spawn?: SpawnGodot;
}

const DEFAULT_ITERATIONS = 100;

export type RunPropertyResult = TestReport & { counterexample?: unknown };

function requireNonBlank(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new ToolInputError(
      `"${field}" must be a positive integer (got ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

function requireInteger(value: number, field: string): number {
  if (!Number.isInteger(value)) {
    throw new ToolInputError(
      `"${field}" must be an integer (got ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

/**
 * Scans `stdout` for the last JSON object and returns its `counterexample`
 * field, if present. Used after a TestReport has already been extracted
 * from the same line, so failure to find an object here means the run
 * simply didn't emit one.
 */
function extractCounterexample(stdout: string): unknown | undefined {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim() !== '');
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'counterexample' in (parsed as Record<string, unknown>)
      ) {
        return (parsed as Record<string, unknown>).counterexample;
      }
    } catch {
      // Not JSON; ignore.
    }
  }
  return undefined;
}

export async function runProperty(
  params: RunPropertyParams,
  deps: RunPropertyDeps = {},
): Promise<RunPropertyResult> {
  const path = requireNonBlank(params.path, 'path');

  let iterations = DEFAULT_ITERATIONS;
  if (params.iterations !== undefined) {
    iterations = requirePositiveInteger(params.iterations, 'iterations');
  }

  let seed: number | undefined;
  if (params.seed !== undefined) {
    seed = requireInteger(params.seed, 'seed');
  }

  const args: string[] = [
    '--headless',
    '--script',
    'addons/gut/gut_cmdln.gd',
    `-gdir=${path}`,
    '-gexit',
  ];

  const env: Record<string, string> = {
    FORGEKIT_PBT_ITERATIONS: String(iterations),
  };
  if (seed !== undefined) {
    env.FORGEKIT_PBT_SEED = String(seed);
  }

  const spawn = deps.spawn ?? defaultSpawnGodot;
  const { stdout, stderr, exitCode } = await spawn(args, { env });

  const report = extractReportFromStdout(stdout);
  if (report === null) {
    return syntheticFailureReport({ stderr, exitCode });
  }

  if (report.failed > 0) {
    const counterexample = extractCounterexample(stdout);
    if (counterexample !== undefined) {
      return { ...report, counterexample };
    }
  }
  return report;
}
