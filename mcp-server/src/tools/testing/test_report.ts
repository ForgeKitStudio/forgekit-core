/**
 * TestReport types and (de)serializer for `@forgekit/core-mcp`.
 *
 * This module mirrors the JSON shape produced by
 * `addons/forgekit_core/testing/test_report.gd`:
 *
 *   TestReport { run_id, timestamp, total, passed, failed, tests[],
 *                suggested_action }
 *   TestCase   { name, status, duration_ms, assertions[], failure_message,
 *                stack_trace }
 *   Assertion  { description, passed, expected, actual }
 *
 * Parsing is defensive: the MCP JSON-RPC dispatcher converts thrown errors
 * into JSON-RPC error responses, so `parseTestReport` throws
 * `TestReportParseError` for any malformed input rather than silently
 * returning a default. The GDScript loader returns defaults because the
 * self-healing loop runs inside the engine and must not crash; on the
 * server boundary we want explicit errors.
 */

/** One of "passed", "failed", "skipped" — producers pick the vocabulary. */
export type TestStatus = 'passed' | 'failed' | 'skipped' | string;

/** The four canonical suggested_action values attached to a failed run. */
export const ALLOWED_SUGGESTED_ACTIONS = [
  'inspect_tres',
  'validate_gdscript',
  'rerun_test',
  'manual_review',
] as const;

/** Type alias for the allowed suggested_action string literals. */
export type SuggestedAction = (typeof ALLOWED_SUGGESTED_ACTIONS)[number];

export interface Assertion {
  description: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface TestCase {
  name: string;
  status: TestStatus;
  duration_ms: number;
  assertions: Assertion[];
  failure_message: string;
  stack_trace: string;
}

export interface TestReport {
  run_id: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  tests: TestCase[];
  /**
   * Empty string when the run has no failures; otherwise one of
   * ALLOWED_SUGGESTED_ACTIONS. Callers are responsible for enforcing the
   * "empty iff failed == 0" contract — the parser accepts any string so
   * existing reports with custom actions still round-trip.
   */
  suggested_action: string;
}

/** Error raised when `parseTestReport` receives malformed input. */
export class TestReportParseError extends Error {
  readonly code = 'TEST_REPORT_PARSE_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'TestReportParseError';
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serializes `report` to a JSON string. Returns a `{ json }` envelope so
 * the MCP tool `test_report.serialize` can return it directly.
 */
export function serializeTestReport(report: TestReport): { json: string } {
  return { json: JSON.stringify(report) };
}

// ---------------------------------------------------------------------------
// Deserialization
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new TestReportParseError(
      `field "${key}" must be a string (got ${describeType(v)}).`,
    );
  }
  return v;
}

function requireInteger(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new TestReportParseError(
      `field "${key}" must be a finite integer (got ${describeType(v)}).`,
    );
  }
  return v;
}

function requireBoolean(obj: Record<string, unknown>, key: string): boolean {
  const v = obj[key];
  if (typeof v !== 'boolean') {
    throw new TestReportParseError(
      `field "${key}" must be a boolean (got ${describeType(v)}).`,
    );
  }
  return v;
}

function requireArray(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new TestReportParseError(
      `field "${key}" must be an array (got ${describeType(v)}).`,
    );
  }
  return v;
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function parseAssertion(raw: unknown, path: string): Assertion {
  if (!isRecord(raw)) {
    throw new TestReportParseError(
      `${path} must be an object (got ${describeType(raw)}).`,
    );
  }
  // Every field is required: a missing "expected" on a passing-by-default
  // assertion would silently drop data on round-trip.
  if (!('expected' in raw)) {
    throw new TestReportParseError(`${path}.expected is missing.`);
  }
  if (!('actual' in raw)) {
    throw new TestReportParseError(`${path}.actual is missing.`);
  }
  return {
    description: requireString(raw, 'description'),
    passed: requireBoolean(raw, 'passed'),
    expected: raw.expected,
    actual: raw.actual,
  };
}

function parseTestCase(raw: unknown, path: string): TestCase {
  if (!isRecord(raw)) {
    throw new TestReportParseError(
      `${path} must be an object (got ${describeType(raw)}).`,
    );
  }
  const assertionsRaw = requireArray(raw, 'assertions');
  const assertions = assertionsRaw.map((a, i) =>
    parseAssertion(a, `${path}.assertions[${i}]`),
  );
  return {
    name: requireString(raw, 'name'),
    status: requireString(raw, 'status'),
    duration_ms: requireInteger(raw, 'duration_ms'),
    assertions,
    failure_message: requireString(raw, 'failure_message'),
    stack_trace: requireString(raw, 'stack_trace'),
  };
}

/**
 * Parses `json` into a `TestReport`. Throws `TestReportParseError` for any
 * malformed input (non-string, invalid JSON, wrong root type, missing or
 * mistyped fields). The error message identifies the offending field.
 */
export function parseTestReport(json: string): TestReport {
  if (typeof json !== 'string') {
    throw new TestReportParseError(
      `input must be a string (got ${describeType(json)}).`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new TestReportParseError(`invalid JSON: ${reason}`);
  }
  if (!isRecord(parsed)) {
    throw new TestReportParseError(
      `root must be an object (got ${describeType(parsed)}).`,
    );
  }

  const testsRaw = requireArray(parsed, 'tests');
  const tests = testsRaw.map((t, i) => parseTestCase(t, `tests[${i}]`));

  return {
    run_id: requireString(parsed, 'run_id'),
    timestamp: requireString(parsed, 'timestamp'),
    total: requireInteger(parsed, 'total'),
    passed: requireInteger(parsed, 'passed'),
    failed: requireInteger(parsed, 'failed'),
    tests,
    suggested_action: requireString(parsed, 'suggested_action'),
  };
}
