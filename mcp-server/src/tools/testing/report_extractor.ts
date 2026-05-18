/**
 * Helpers shared by every `tests.run_*` tool.
 *
 * The spawned Godot process is expected to print a single line of JSON
 * matching the `TestReport` schema. The real GUT-to-TestReport adapter
 * ships later; until it does, the run_* tools extract the last non-empty
 * JSON line that parses as a TestReport. When no such line exists the
 * tools fall back to a synthetic failed report so the self-healing loop
 * always receives a well-formed result.
 */

import type { TestReport } from './test_report.js';
import { parseTestReport } from './test_report.js';

const MAX_STDERR_CHARS = 4096;

/** Sentinel markers emitted by `gut_to_test_report_hook.gd`. */
const REPORT_BEGIN_SENTINEL = '##FORGEKIT_TEST_REPORT_BEGIN##';
const REPORT_END_SENTINEL = '##FORGEKIT_TEST_REPORT_END##';

/** Returns the first TestReport found on any line of `stdout`, or null. */
export function extractReportFromStdout(stdout: string): TestReport | null {
  // Prefer the sentinel-wrapped block emitted by the GUT post-run hook
  // (`addons/forgekit_core/testing/gut_to_test_report_hook.gd`). The
  // sentinels make extraction robust even when other JSON-shaped
  // diagnostics appear earlier in the GUT log.
  const sentinel = extractBetweenSentinels(stdout);
  if (sentinel !== null) {
    try {
      return parseTestReport(sentinel);
    } catch {
      // Fall through to the line-scan fallback below.
    }
  }

  // Iterate from the last line so a noisy GUT run still yields the final
  // report. `parseTestReport` throws for non-reports; catch and keep going.
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim() !== '');
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      return parseTestReport(trimmed);
    } catch {
      // Not a TestReport line; keep scanning.
    }
  }
  return null;
}

/**
 * Extracts the JSON body wrapped between
 * `##FORGEKIT_TEST_REPORT_BEGIN##` / `##FORGEKIT_TEST_REPORT_END##`.
 * Returns the trimmed body or `null` when either sentinel is missing.
 */
function extractBetweenSentinels(stdout: string): string | null {
  const begin = stdout.indexOf(REPORT_BEGIN_SENTINEL);
  if (begin === -1) return null;
  const after = begin + REPORT_BEGIN_SENTINEL.length;
  const end = stdout.indexOf(REPORT_END_SENTINEL, after);
  if (end === -1) return null;
  return stdout.slice(after, end).trim();
}

/**
 * Builds a TestReport marking the whole run as a single failure. Used when
 * the spawned process produced no parseable report.
 */
export function syntheticFailureReport(opts: {
  stderr: string;
  exitCode: number;
}): TestReport {
  const message = truncate(
    opts.stderr.length > 0
      ? opts.stderr
      : `godot exited with code ${opts.exitCode} and produced no TestReport`,
    MAX_STDERR_CHARS,
  );
  return {
    run_id: '',
    timestamp: new Date().toISOString(),
    total: 0,
    passed: 0,
    failed: 1,
    tests: [
      {
        name: 'spawn',
        status: 'failed',
        duration_ms: 0,
        assertions: [],
        failure_message: message,
        stack_trace: '',
      },
    ],
    suggested_action: 'rerun_test',
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}
