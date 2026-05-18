/**
 * Feature: forgekit, Property 53: ChannelRouter selects channel iff profile entry says so
 *
 * Validates: Wymagania 5.2, 7.2, 8.3, 17.4
 *
 * For every random subset of tools (size in [1..50]) drawn from the
 * package's `profiles.json`, the `ChannelRouter` dispatches each tool
 * call to exactly the transport client whose `channel` field matches
 * the tool's declared channel:
 *
 *   - editor  -> editorClient.send
 *   - runtime -> runtimeClient.send
 *   - cli     -> cliExecutor.invoke
 *   - cross   -> crossExecutor.invoke
 *
 * For every dispatch the test asserts that:
 *   1. The matching client receives exactly one call with `(method,
 *      params)` equal to the dispatched values.
 *   2. The other three clients receive zero calls.
 *   3. The router returns `DispatchOk` whose `result` is the value
 *      resolved by the matching client.
 *
 * Verified with 100 fast-check iterations.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    ChannelRouter,
    type CliChannelExecutor,
    type CrossChannelExecutor,
    type EditorChannelClient,
    type RuntimeChannelClient,
} from '../../src/dispatcher/channel_router.js';
import {
    loadProfiles,
    type ProfilesFile,
    type ToolChannel,
} from '../../src/profiles.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Pinned iteration count for this property. */
const NUM_RUNS = 100 as const;

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILES_PATH = resolve(HERE, '..', '..', 'profiles.json');

/**
 * Sentinel result returned by each stub client. Kept distinct per
 * channel so the test can assert that the router unwraps the matching
 * client's value into `DispatchOk.result`.
 */
const RESULT_BY_CHANNEL: Record<ToolChannel, string> = {
    editor: 'editor-result',
    runtime: 'runtime-result',
    cli: 'cli-result',
    cross: 'cross-result',
};

// --------------------------------------------------------------------------
// Stub harness — counts calls per channel, never reaches a real socket.
// --------------------------------------------------------------------------

interface RouteCallLog {
    editor: Array<{ method: string; params: unknown }>;
    runtime: Array<{ method: string; params: unknown }>;
    cli: Array<{ method: string; params: unknown }>;
    cross: Array<{ method: string; params: unknown }>;
}

interface Harness {
    router: ChannelRouter;
    log: RouteCallLog;
}

function makeHarness(profiles: ProfilesFile): Harness {
    const log: RouteCallLog = {
        editor: [],
        runtime: [],
        cli: [],
        cross: [],
    };
    const editorClient: EditorChannelClient = {
        async send(method, params) {
            log.editor.push({ method, params });
            return RESULT_BY_CHANNEL.editor;
        },
        isConnected: () => true,
    };
    const runtimeClient: RuntimeChannelClient = {
        async send(method, params) {
            log.runtime.push({ method, params });
            return RESULT_BY_CHANNEL.runtime;
        },
        isConnected: () => true,
    };
    const cliExecutor: CliChannelExecutor = {
        async invoke(method, params) {
            log.cli.push({ method, params });
            return RESULT_BY_CHANNEL.cli;
        },
    };
    const crossExecutor: CrossChannelExecutor = {
        async invoke(method, params) {
            log.cross.push({ method, params });
            return RESULT_BY_CHANNEL.cross;
        },
    };
    const router = new ChannelRouter({
        profiles,
        editorClient,
        runtimeClient,
        cliExecutor,
        crossExecutor,
    });
    return { router, log };
}

// --------------------------------------------------------------------------
// Arbitraries
// --------------------------------------------------------------------------

/**
 * Random JSON-ish params object. The router forwards `params`
 * verbatim so we just need values that round-trip through
 * structuredClone-equivalent equality.
 */
function paramsArb(): fc.Arbitrary<Record<string, unknown>> {
    return fc.dictionary(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
        ),
        { maxKeys: 4 },
    );
}

// --------------------------------------------------------------------------
// Property
// --------------------------------------------------------------------------

describe('Feature: forgekit, Property 53: ChannelRouter selects channel iff profile entry says so', () => {
    it('dispatches each tool call to the client whose channel matches the profile entry, and to no other client', async () => {
        const profiles = await loadProfiles(PROFILES_PATH);
        const tools = profiles.tools;
        expect(tools.length).toBeGreaterThan(0);

        // Pick a non-empty subset of tools (by index, deduplicated) of
        // size 1..50, then draw one params object per chosen tool so
        // every dispatch carries an independent payload.
        const callBatchArb = fc
            .uniqueArray(
                fc.integer({ min: 0, max: tools.length - 1 }),
                { minLength: 1, maxLength: 50 },
            )
            .chain((indices) =>
                fc
                    .array(paramsArb(), {
                        minLength: indices.length,
                        maxLength: indices.length,
                    })
                    .map((paramsList) =>
                        indices.map((toolIndex, callIndex) => ({
                            tool: tools[toolIndex]!,
                            params: paramsList[callIndex]!,
                        })),
                    ),
            );

        await fc.assert(
            fc.asyncProperty(callBatchArb, async (calls) => {
                const harness = makeHarness(profiles);

                // Run every dispatch. The router must hand each call to
                // the client matching the tool's declared channel and
                // surface the resolved value as DispatchOk.result.
                for (const call of calls) {
                    const result = await harness.router.dispatch(
                        call.tool.name,
                        call.params,
                    );
                    expect(result).toEqual({
                        kind: 'ok',
                        result: RESULT_BY_CHANNEL[call.tool.channel],
                    });
                }

                // The expected per-channel call log derived from the
                // profile entries: each call lands on its tool's
                // declared channel only, in dispatch order.
                const expected: RouteCallLog = {
                    editor: [],
                    runtime: [],
                    cli: [],
                    cross: [],
                };
                for (const call of calls) {
                    expected[call.tool.channel].push({
                        method: call.tool.name,
                        params: call.params,
                    });
                }

                // The observed log must match exactly: every dispatch
                // reached its declared channel with the verbatim params,
                // and the other three clients received zero traffic for
                // that call.
                expect(harness.log).toEqual(expected);
            }),
            { numRuns: NUM_RUNS },
        );
    });
});
