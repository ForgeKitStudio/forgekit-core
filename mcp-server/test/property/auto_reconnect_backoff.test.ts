/**
 * Feature: forgekit, Property 54: Auto-reconnect backoff is exponential with bounds
 *
 * Property 54 — for any random sequence of disconnect events (length
 * N ∈ [1..20]) interleaved with successful reconnections, the
 * `AutoReconnect` state machine must satisfy:
 *
 *   1. Every scheduled backoff is ≥ 1000 ms and ≤ 60000 ms.
 *   2. The first scheduled backoff after construction or after a
 *      successful reconnect (`onConnected()`) is exactly 1000 ms — the
 *      schedule resets to 1 s.
 *   3. Two consecutive `nextBackoffMs()` calls (with no `onConnected()`
 *      in between) double the delay, capped at the 60 s ceiling. In
 *      other words, the next delay is ≥ min(previous × 2, 60000).
 *
 * Validates: Wymagania 21.1.
 *
 * Notes
 * -----
 *
 * Although the project glossary cross-references Auto_Reconnect from
 * the WebSocket section (Wymaganie 23), this property test is tagged
 * against Wymaganie 21 because the spec task list (8.15) explicitly
 * binds Property 54 to that requirement; the underlying state machine
 * is the same.
 *
 * The schedule under test (`DEFAULT_BACKOFF_SCHEDULE_MS`) is
 * `1000, 2000, 4000, 8000, 16000, 32000, 60000`. The doubling rule
 * `next ≥ min(prev × 2, 60000)` is satisfied by every adjacent pair —
 * including the final 32000 → 60000 step (which jumps to the cap
 * rather than to 64000) and the cap-to-cap 60000 → 60000 plateau.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { AutoReconnect } from '../../src/auto_reconnect.js';
import { Metrics } from '../../src/metrics.js';

/** Lower bound for any scheduled backoff (ms). */
const MIN_BACKOFF_MS = 1000;

/** Upper bound (cap) for any scheduled backoff (ms). */
const MAX_BACKOFF_MS = 60_000;

/** Per `tasks.md` 8.15: random sequence length is in [1..20]. */
const MIN_EVENTS = 1;
const MAX_EVENTS = 20;

/** Per `tasks.md` 8.15: 100 iterations. */
const NUM_RUNS = 100;

type Event = { kind: 'attempt' } | { kind: 'success' };

describe('Property 54 — Auto-reconnect backoff is exponential with bounds [1s, 60s]', () => {
    it('respects bounds, exponential doubling (capped), and reset-on-success semantics', () => {
        // Bias the generator toward `attempt` events so the property
        // exercises the cap (≥ 7 attempts in a row) frequently while still
        // sprinkling in `success` events that force schedule resets.
        const eventGen: fc.Arbitrary<Event> = fc.oneof(
            { weight: 5, arbitrary: fc.constant<Event>({ kind: 'attempt' }) },
            { weight: 1, arbitrary: fc.constant<Event>({ kind: 'success' }) },
        );
        const sequenceGen = fc.array(eventGen, {
            minLength: MIN_EVENTS,
            maxLength: MAX_EVENTS,
        });

        fc.assert(
            fc.property(sequenceGen, (events) => {
                const manager = new AutoReconnect(new Metrics());

                // `previousBackoff === null` means "no attempt has been made
                // since the last reset (or since construction)", so the next
                // scheduled backoff must be exactly the minimum (1 s).
                let previousBackoff: number | null = null;

                for (const event of events) {
                    if (event.kind === 'success') {
                        manager.onConnected();
                        previousBackoff = null;
                        continue;
                    }

                    const backoff = manager.nextBackoffMs();

                    // Bound check: backoff is always within [1 s, 60 s].
                    if (backoff < MIN_BACKOFF_MS) {
                        return false;
                    }
                    if (backoff > MAX_BACKOFF_MS) {
                        return false;
                    }

                    if (previousBackoff === null) {
                        // First attempt after a reset (or after construction)
                        // must start at exactly 1 s — the schedule's lower bound.
                        if (backoff !== MIN_BACKOFF_MS) {
                            return false;
                        }
                    } else {
                        // Subsequent attempts must double the previous delay,
                        // capped at MAX_BACKOFF_MS.
                        const expectedAtLeast = Math.min(
                            previousBackoff * 2,
                            MAX_BACKOFF_MS,
                        );
                        if (backoff < expectedAtLeast) {
                            return false;
                        }
                    }

                    previousBackoff = backoff;
                }

                return true;
            }),
            { numRuns: NUM_RUNS },
        );
    });
});
