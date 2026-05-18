/**
 * Implementation of the `tests.run_unit` MCP tool.
 *
 * Spawns Godot headless with the GUT command-line driver and parses the
 * last JSON line of stdout into a `TestReport`. Flag names come from GUT's
 * `gut_cli.gd`: `-gdir=<path>`, `-gunit_test_name=<pattern>`, `-gexit`.
 *
 * A malformed / missing report combined with a non-zero exit code produces
 * a synthetic failed report rather than throwing, so the self-healing loop
 * always receives a well-formed TestReport.
 */

import { ToolInputError } from './errors.js';
import {
  extractReportFromStdout,
  syntheticFailureReport,
} from './report_extractor.js';
import { defaultSpawnGodot, type SpawnGodot } from './spawn_godot.js';
import type { TestReport } from './test_report.js';

export interface RunUnitParams {
  /** Directory containing GUT test scripts (passed as `-gdir=<path>`). */
  path: string;
  /** Optional GUT `-gunit_test_name` filter. */
  pattern?: string;
}

export interface RunUnitDeps {
  spawn?: SpawnGodot;
}

/** Validates a required string param — rejects empty / whitespace-only. */
function requireNonBlank(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(
      `"${field}" must be a non-empty string (got ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

/**
 * Runs GUT against `params.path` and returns the resulting `TestReport`.
 */
export async function runUnit(
  params: RunUnitParams,
  deps: RunUnitDeps = {},
): Promise<TestReport> {
  const path = requireNonBlank(params.path, 'path');
  if (params.pattern !== undefined) {
    requireNonBlank(params.pattern, 'pattern');
  }

  const args: string[] = [
    '--headless',
    '--script',
    'addons/gut/gut_cmdln.gd',
    `-gdir=${path}`,
    '-gpost_run_script=res://addons/forgekit_core/testing/gut_to_test_report_hook.gd',
    '-gexit',
  ];
  if (params.pattern !== undefined) {
    args.push(`-gunit_test_name=${params.pattern}`);
  }

  const spawn = deps.spawn ?? defaultSpawnGodot;
  const { stdout, stderr, exitCode } = await spawn(args);

  const report = extractReportFromStdout(stdout);
  if (report !== null) {
    return report;
  }
  return syntheticFailureReport({ stderr, exitCode });
}
