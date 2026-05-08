/**
 * Feature: forgekit, Property 30: Input_Simulator emits correct action for every declared action
 *
 * Property-based test for the runtime Input_Simulator surfaced through
 * the `input.simulate_action` MCP tool. The simulator lives in the
 * runtime bridge and emits `InputEventAction` instances via
 * `Input.parse_input_event`; its observable contract is that, after the
 * emit, `Input.is_action_pressed(a)` reflects the `pressed` flag passed
 * to the call.
 *
 * Property (design §10.2, Property 30):
 *   For any action `a` declared in `InputMap` and any `(strength, pressed)`
 *   pair in the valid input space, calling
 *   `simulate_action(a, strength, pressed)` SHALL cause
 *   `Input.is_action_pressed(a) === pressed` on the next frame.
 *
 * The invariant is about engine state, so it cannot be verified in
 * pure TypeScript. The test collects every fast-check sample into a
 * batch and dispatches it to the Godot driver at
 * `tools/cli_runner/simulate_actions_batch.gd` in a single headless
 * spawn (same batching pattern as Property 14 / GDScript validator).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  simulateActionBatch,
  type InputObservation,
  type InputSample,
} from './helpers/input_simulator_client.js';

/** Pinned iteration count for this property. */
const NUM_RUNS = 100 as const;

/**
 * The four canonical actions named in Requirement 13.4. The driver
 * registers these in `InputMap` at init time so the property sweep is
 * independent of whatever `project.godot` currently declares.
 */
const DECLARED_ACTIONS = [
  'ui_accept',
  'ui_cancel',
  'attack',
  'interact',
] as const;

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

const actionArb = fc.constantFrom(...DECLARED_ACTIONS);

/**
 * Strength is in `[0.0, 1.0]` per the MCP server's `requireStrength`
 * guard. `fc.double` with `noNaN` and bounds gives a wide finite
 * distribution; the engine accepts zero and non-zero values alike.
 */
const strengthArb = fc.double({
  min: 0.0,
  max: 1.0,
  noNaN: true,
  noDefaultInfinity: true,
});

const sampleArb: fc.Arbitrary<InputSample> = fc.record({
  action: actionArb,
  strength: strengthArb,
  pressed: fc.boolean(),
});

// --------------------------------------------------------------------------
// Property — one Godot spawn drives the whole batch.
// --------------------------------------------------------------------------

describe('Property 30: Input_Simulator emits correct action for every declared action', () => {
  it('is_action_pressed(a) === pressed for every (action, strength, pressed) sample', async () => {
    // Collect every fast-check sample into a batch so the whole sweep
    // travels to Godot in one spawn.
    const samples: InputSample[] = [];
    await fc.assert(
      fc.property(sampleArb, (sample) => {
        samples.push(sample);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );

    expect(samples).toHaveLength(NUM_RUNS);

    const observations: InputObservation[] = await simulateActionBatch(samples);
    expect(observations).toHaveLength(samples.length);

    // Assert the invariant for each sample. Using raw expect rather than
    // a second fast-check pass keeps the counterexample direct: if this
    // fails, the index `i` and the sample payload are in the message.
    for (let i = 0; i < samples.length; i++) {
      const { action, strength, pressed } = samples[i];
      const obs = observations[i];
      expect(
        obs.isActionPressed,
        `sample ${i} (${JSON.stringify({ action, strength, pressed })}) — ` +
          `Input.is_action_pressed(${JSON.stringify(action)}) must equal ${pressed}`,
      ).toBe(pressed);
    }
  }, 120_000);
});
