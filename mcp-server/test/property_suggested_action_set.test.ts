/**
 * Feature: forgekit, Property 23: suggested_action for a failed TestReport belongs to the defined set
 *
 * For every randomly-generated failed `TestReport` with an arbitrary
 * `failure_message`, `suggestAction(report).suggested_action` must be
 * an element of
 * `{"inspect_tres", "validate_gdscript", "rerun_test", "manual_review"}`.
 * 100 iterations via fast-check.
 *
 * The TypeScript suggester under `src/healing/suggest_action.ts` mirrors
 * the GDScript copy; any rule change must land in both files.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_SUGGESTED_ACTIONS,
  TestReport,
  suggestAction,
} from '../src/healing/suggest_action.js';

const NUM_RUNS = 100 as const;

const failureMessageArb: fc.Arbitrary<string> = fc.oneof(
  // Fully random strings.
  fc.string(),
  // Strings that will trigger each known pattern at least sometimes.
  fc.constantFrom(
    'ext_resource not found',
    'Parse error at line 12',
    'unexpected token',
    'timed out after 30 seconds',
    'looks flaky',
    '.tres file missing',
    '',
  ),
  // Unicode / long noise.
  fc.unicodeString({ minLength: 0, maxLength: 200 }),
);

const reportArb: fc.Arbitrary<TestReport> = fc.record({
  status: fc.constant('failed'),
  failure_message: failureMessageArb,
  resource_path: fc.string({ minLength: 0, maxLength: 120 }),
});

describe('Property 23: suggested_action for a failed TestReport belongs to the defined set', () => {
  it('every random failed TestReport maps to an allowed suggested_action', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const result = suggestAction(report);
        expect(ALLOWED_SUGGESTED_ACTIONS).toContain(result.suggested_action);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
