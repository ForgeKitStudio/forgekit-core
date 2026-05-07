/**
 * Unit tests for the TestReport (de)serializer.
 *
 * The shape mirrors `addons/forgekit_core/testing/test_report.gd`:
 *   TestReport { run_id, timestamp, total, passed, failed, tests[],
 *                suggested_action }
 *   TestCase   { name, status, duration_ms, assertions[], failure_message,
 *                stack_trace }
 *   Assertion  { description, passed, expected, actual }
 *
 * The TypeScript parser is stricter than the GDScript one: malformed JSON,
 * a non-object root, or any type-mismatch in a required field raises
 * `TestReportParseError` instead of silently returning a default. The MCP
 * dispatcher relies on thrown errors to produce JSON-RPC error responses,
 * so returning a "defaulted" report on bad input would hide the bug.
 *
 * The round-trip property lives in the canonical property-test file at
 * `test/property_testreport_roundtrip.test.ts` (Property 3).
 */

import { describe, expect, it } from 'vitest';

import type {
  Assertion,
  TestCase,
  TestReport,
} from '../../../src/tools/testing/test_report.js';
import {
  ALLOWED_SUGGESTED_ACTIONS,
  parseTestReport,
  serializeTestReport,
  TestReportParseError,
} from '../../../src/tools/testing/test_report.js';

// ---------------------------------------------------------------------------
// Canonical small reports used across the tests. Keeping one assertion /
// test case / report per quadrant means shape mistakes are obvious.
// ---------------------------------------------------------------------------

const emptyReport: TestReport = {
  run_id: 'run-000',
  timestamp: '2025-01-01T00:00:00Z',
  total: 0,
  passed: 0,
  failed: 0,
  tests: [],
  suggested_action: '',
};

const passingCase: TestCase = {
  name: 'it passes',
  status: 'passed',
  duration_ms: 3,
  assertions: [
    {
      description: 'value is true',
      passed: true,
      expected: true,
      actual: true,
    },
  ],
  failure_message: '',
  stack_trace: '',
};

const failingAssertion: Assertion = {
  description: 'count matches',
  passed: false,
  expected: 2,
  actual: 1,
};

const failingCase: TestCase = {
  name: 'it fails',
  status: 'failed',
  duration_ms: 17,
  assertions: [failingAssertion],
  failure_message: 'expected 2 got 1',
  stack_trace: 'at test.gd:42',
};

const mixedReport: TestReport = {
  run_id: 'run-042',
  timestamp: '2025-01-02T12:34:56Z',
  total: 2,
  passed: 1,
  failed: 1,
  tests: [passingCase, failingCase],
  suggested_action: 'rerun_test',
};

// ---------------------------------------------------------------------------
// ALLOWED_SUGGESTED_ACTIONS mirrors the authoritative GDScript constant.
// ---------------------------------------------------------------------------

describe('ALLOWED_SUGGESTED_ACTIONS', () => {
  it('lists exactly the four values from test_report.gd', () => {
    expect([...ALLOWED_SUGGESTED_ACTIONS]).toEqual([
      'inspect_tres',
      'validate_gdscript',
      'rerun_test',
      'manual_review',
    ]);
  });
});

// ---------------------------------------------------------------------------
// serializeTestReport
// ---------------------------------------------------------------------------

describe('serializeTestReport', () => {
  it('returns a { json } envelope whose body parses back to the input', () => {
    const out = serializeTestReport(mixedReport);
    expect(Object.keys(out)).toEqual(['json']);
    expect(typeof out.json).toBe('string');
    expect(JSON.parse(out.json)).toEqual(mixedReport);
  });

  it('preserves Unicode in failure_message and stack_trace', () => {
    const unicodeCase: TestCase = {
      ...failingCase,
      failure_message: 'błąd: αβγ — 日本語',
      stack_trace: 'at módulo.gd:7',
    };
    const r: TestReport = { ...mixedReport, tests: [unicodeCase] };
    const { json } = serializeTestReport(r);
    expect(JSON.parse(json)).toEqual(r);
  });

  it('serializes a zero-test report', () => {
    const { json } = serializeTestReport(emptyReport);
    expect(JSON.parse(json)).toEqual(emptyReport);
  });
});

// ---------------------------------------------------------------------------
// parseTestReport — happy path
// ---------------------------------------------------------------------------

describe('parseTestReport — happy path', () => {
  it('reads back a report produced by serializeTestReport', () => {
    const { json } = serializeTestReport(mixedReport);
    expect(parseTestReport(json)).toEqual(mixedReport);
  });

  it('reads back an empty report', () => {
    const { json } = serializeTestReport(emptyReport);
    expect(parseTestReport(json)).toEqual(emptyReport);
  });
});

// ---------------------------------------------------------------------------
// parseTestReport — malformed input raises TestReportParseError
// ---------------------------------------------------------------------------

describe('parseTestReport — rejects malformed input', () => {
  it('throws TestReportParseError for non-string input', () => {
    // Intentionally cast through unknown: the dispatcher may pass through
    // any JSON-RPC payload and we want a typed error at the boundary.
    expect(() => parseTestReport(123 as unknown as string)).toThrow(
      TestReportParseError,
    );
  });

  it('throws TestReportParseError for syntactically invalid JSON', () => {
    expect(() => parseTestReport('{not json')).toThrow(TestReportParseError);
  });

  it('throws TestReportParseError when the JSON root is not an object', () => {
    expect(() => parseTestReport('[]')).toThrow(TestReportParseError);
    expect(() => parseTestReport('"hi"')).toThrow(TestReportParseError);
    expect(() => parseTestReport('null')).toThrow(TestReportParseError);
  });

  it('throws when a required top-level string field is missing', () => {
    const bad = JSON.stringify({ ...mixedReport, run_id: undefined });
    expect(() => parseTestReport(bad)).toThrow(TestReportParseError);
  });

  it('throws when a required counter field is not a finite integer', () => {
    const bad = JSON.stringify({ ...mixedReport, total: 'two' });
    expect(() => parseTestReport(bad)).toThrow(TestReportParseError);
  });

  it('throws when tests is not an array', () => {
    const bad = JSON.stringify({ ...mixedReport, tests: {} });
    expect(() => parseTestReport(bad)).toThrow(TestReportParseError);
  });

  it('throws when a test case is missing assertions', () => {
    const brokenCase = { ...passingCase } as Partial<TestCase>;
    delete brokenCase.assertions;
    const bad = JSON.stringify({
      ...mixedReport,
      tests: [brokenCase],
    });
    expect(() => parseTestReport(bad)).toThrow(TestReportParseError);
  });

  it('throws when an assertion has a non-boolean passed', () => {
    const bad = JSON.stringify({
      ...mixedReport,
      tests: [
        {
          ...passingCase,
          assertions: [{ ...failingAssertion, passed: 'no' }],
        },
      ],
    });
    expect(() => parseTestReport(bad)).toThrow(TestReportParseError);
  });
});

// ---------------------------------------------------------------------------
// Property 3: Round-trip for TestReport (JSON) lives in the canonical
// property-test file at `mcp-server/test/property_testreport_roundtrip.test.ts`.
// ---------------------------------------------------------------------------
