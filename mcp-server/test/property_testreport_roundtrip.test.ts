/**
 * Feature: forgekit, Property 3: Round-trip for TestReport (JSON)
 *
 * Property-based test for {@link serializeTestReport} + {@link parseTestReport}.
 *
 * The nested shape (Assertion -> TestCase -> TestReport) mirrors the
 * GDScript producer in `addons/forgekit_core/testing/test_report.gd`.
 * Any report that the producer could emit must survive a JSON round-trip
 * through the TypeScript (de)serializer unchanged; otherwise the
 * self-healing loop receives corrupted evidence and cannot reproduce a
 * failure.
 *
 * The generator emits Unicode code points (including non-BMP) into
 * `failure_message` on purpose: surrogate-pair escaping inside
 * JSON.stringify / JSON.parse is the part of the pipeline most likely to
 * silently drop data, and GDScript reports regularly carry emoji, CJK,
 * and combining marks from non-English test names.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type {
  Assertion,
  TestCase,
  TestReport,
} from '../src/tools/testing/test_report.js';
import {
  ALLOWED_SUGGESTED_ACTIONS,
  parseTestReport,
  serializeTestReport,
} from '../src/tools/testing/test_report.js';

const NUM_RUNS = 100 as const;

/**
 * Any value that survives JSON.stringify + JSON.parse unchanged. Excludes
 * NaN, +/- Infinity, undefined and functions: those are not expressible in
 * JSON, so letting them into the generator would mean testing a property
 * that cannot hold rather than finding a bug.
 */
const jsonSafeValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  leaf: fc.oneof(
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string(),
  ),
  tree: fc.oneof(
    { maxDepth: 3 },
    tie('leaf'),
    fc.array(tie('tree'), { maxLength: 3 }),
    fc.dictionary(fc.string(), tie('tree'), { maxKeys: 3 }),
  ),
})).tree as fc.Arbitrary<unknown>;

const assertionArb: fc.Arbitrary<Assertion> = fc.record({
  description: fc.string(),
  passed: fc.boolean(),
  expected: jsonSafeValue,
  actual: jsonSafeValue,
});

/**
 * Unicode-heavy string for the `failure_message` slot. `fullUnicodeString`
 * spans the full code-point range, including the astral planes, which is
 * where JSON's \uXXXX escaping is most error-prone.
 */
const unicodeMessage = fc.fullUnicodeString();

const testCaseArb: fc.Arbitrary<TestCase> = fc.record({
  name: fc.string(),
  status: fc.constantFrom('passed', 'failed', 'skipped'),
  duration_ms: fc.integer({ min: 0, max: 60_000 }),
  assertions: fc.array(assertionArb, { maxLength: 4 }),
  failure_message: unicodeMessage,
  stack_trace: fc.string(),
});

/**
 * Root generator. Shape taken directly from the task description:
 * `fc.record({ run_id, timestamp, total, passed, failed, tests: fc.array(testCase) })`.
 * `suggested_action` is drawn from the authoritative vocabulary plus
 * the empty-string sentinel.
 */
const testReportArb: fc.Arbitrary<TestReport> = fc.record({
  run_id: fc.string(),
  timestamp: fc.string(),
  total: fc.integer({ min: 0, max: 1000 }),
  passed: fc.integer({ min: 0, max: 1000 }),
  failed: fc.integer({ min: 0, max: 1000 }),
  tests: fc.array(testCaseArb, { maxLength: 4 }),
  suggested_action: fc.oneof(
    fc.constant(''),
    fc.constantFrom(...ALLOWED_SUGGESTED_ACTIONS),
  ),
});

describe('Property 3: Round-trip for TestReport (JSON)', () => {
  it('parseTestReport(serializeTestReport(r).json) structurally equals r', () => {
    fc.assert(
      fc.property(testReportArb, (report) => {
        const { json } = serializeTestReport(report);
        const back = parseTestReport(json);
        expect(back).toEqual(report);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
