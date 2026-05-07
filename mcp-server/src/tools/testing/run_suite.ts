/**
 * Implementation of the `tests.run_suite` MCP tool.
 *
 * Runs a single named GUT suite via `-gtest=<suite_name>`. The suite name
 * is passed as a single argv element so it never reaches a shell: spaces,
 * quotes and Unicode characters in the name are safe.
 */

import { ToolInputError } from './errors.js';
import {
  extractReportFromStdout,
  syntheticFailureReport,
} from './report_extractor.js';
import { defaultSpawnGodot, type SpawnGodot } from './spawn_godot.js';
import type { TestReport } from './test_report.js';

export interface RunSuiteParams {
  suite_name: string;
}

export interface RunSuiteDeps {
  spawn?: SpawnGodot;
}

export async function runSuite(
  params: RunSuiteParams,
  deps: RunSuiteDeps = {},
): Promise<TestReport> {
  const suiteName = params.suite_name;
  if (typeof suiteName !== 'string' || suiteName.trim() === '') {
    throw new ToolInputError(
      `"suite_name" must be a non-empty string (got ${JSON.stringify(suiteName)}).`,
    );
  }

  const args: string[] = [
    '--headless',
    '--script',
    'addons/gut/gut_cmdln.gd',
    `-gtest=${suiteName}`,
    '-gexit',
  ];

  const spawn = deps.spawn ?? defaultSpawnGodot;
  const { stdout, stderr, exitCode } = await spawn(args);

  const report = extractReportFromStdout(stdout);
  if (report !== null) {
    return report;
  }
  return syntheticFailureReport({ stderr, exitCode });
}
