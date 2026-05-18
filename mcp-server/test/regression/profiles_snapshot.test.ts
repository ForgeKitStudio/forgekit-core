/**
 * Snapshot regression for `profiles.json`.
 *
 * The tool surface manifest is part of the v0.10 wire contract: every
 * MCP client that already runs against v0.9.2 hard-codes the `name`,
 * `channel`, `scope`, and `module` of the tools it cares about.
 * Renaming a tool, moving it to a different channel, narrowing its
 * scope, or reassigning its module breaks those clients.
 *
 * This test pins the v0.9.2 baseline and asserts:
 *
 *   - Every tool that existed in v0.9.2 still exists in the current
 *     `profiles.json`.
 *   - For each pre-existing tool, all four pinned attributes match the
 *     baseline byte-for-byte.
 *   - New tools beyond the baseline are allowed (additive surface
 *     growth is permitted by Requirement 73).
 *
 * Failure shape: when an existing entry has been modified, the test
 * reports the diff per-tool so the operator can either revert the
 * change or — when the change is intentional — refresh the snapshot
 * file at `profiles_v0_9_2.snapshot.json` and explicitly review the
 * diff in code review.
 *
 * Validates: Requirements 17.4, 73.1, 73.2.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ProfilesFile, ToolEntry } from '../../src/profiles.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Path to the live `profiles.json` shipped with the package. */
const CURRENT_PROFILES_PATH = join(HERE, '..', '..', 'profiles.json');

/** Path to the captured v0.9.2 baseline snapshot. */
const SNAPSHOT_PATH = join(HERE, 'profiles_v0_9_2.snapshot.json');

/** The four pinned attributes that form the wire contract per tool. */
type PinnedAttribute = 'name' | 'scope' | 'channel' | 'module';

const PINNED_ATTRIBUTES: ReadonlyArray<PinnedAttribute> = [
    'name',
    'scope',
    'channel',
    'module',
];

async function readProfiles(path: string): Promise<ProfilesFile> {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as ProfilesFile;
}

function indexByName(tools: ReadonlyArray<ToolEntry>): Map<string, ToolEntry> {
    const out = new Map<string, ToolEntry>();
    for (const tool of tools) {
        out.set(tool.name, tool);
    }
    return out;
}

interface AttributeDiff {
    readonly name: string;
    readonly attribute: PinnedAttribute;
    readonly snapshot: string;
    readonly current: string;
}

function diffEntry(snapshot: ToolEntry, current: ToolEntry): AttributeDiff[] {
    const diffs: AttributeDiff[] = [];
    for (const key of PINNED_ATTRIBUTES) {
        if (snapshot[key] !== current[key]) {
            diffs.push({
                name: snapshot.name,
                attribute: key,
                snapshot: snapshot[key],
                current: current[key],
            });
        }
    }
    return diffs;
}

function formatDiff(diffs: ReadonlyArray<AttributeDiff>): string {
    return diffs
        .map(
            (d) =>
                `  - ${d.name}.${d.attribute}: snapshot="${d.snapshot}" current="${d.current}"`,
        )
        .join('\n');
}

describe('profiles.json — v0.9.2 snapshot regression', () => {
    it('every tool present in the v0.9.2 snapshot is still present in the current profiles.json', async () => {
        const snapshot = await readProfiles(SNAPSHOT_PATH);
        const current = await readProfiles(CURRENT_PROFILES_PATH);
        const currentIndex = indexByName(current.tools);

        const missing = snapshot.tools
            .filter((entry) => !currentIndex.has(entry.name))
            .map((entry) => entry.name);

        expect(
            missing,
            `Tools removed since v0.9.2 (regression). To intentionally drop a tool, ` +
            `update test/regression/profiles_v0_9_2.snapshot.json and document the ` +
            `removal in CHANGELOG.md as a BREAKING change:\n  - ` +
            missing.join('\n  - '),
        ).toEqual([]);
    });

    it('no pre-existing tool has had its name, channel, scope, or module changed', async () => {
        const snapshot = await readProfiles(SNAPSHOT_PATH);
        const current = await readProfiles(CURRENT_PROFILES_PATH);
        const currentIndex = indexByName(current.tools);

        const allDiffs: AttributeDiff[] = [];
        for (const baseline of snapshot.tools) {
            const live = currentIndex.get(baseline.name);
            if (live === undefined) {
                // Removal is asserted by the test above; skip to keep
                // this assertion focused on attribute drift.
                continue;
            }
            allDiffs.push(...diffEntry(baseline, live));
        }

        expect(
            allDiffs,
            `Pinned attributes changed for tools that existed in v0.9.2. ` +
            `Each change is a wire contract break for clients that hard-code ` +
            `the tool surface. To accept the change explicitly, refresh ` +
            `test/regression/profiles_v0_9_2.snapshot.json and add a CHANGELOG ` +
            `entry under "### Changed":\n` +
            formatDiff(allDiffs),
        ).toEqual([]);
    });

    it('allows new tools beyond the snapshot (additive surface growth)', async () => {
        const snapshot = await readProfiles(SNAPSHOT_PATH);
        const current = await readProfiles(CURRENT_PROFILES_PATH);

        const snapshotNames = new Set(snapshot.tools.map((t) => t.name));
        const newTools = current.tools
            .filter((t) => !snapshotNames.has(t.name))
            .map((t) => t.name);

        // The assertion is informational: the count is expected to be
        // >= 0 with no upper bound. This statement documents the
        // contract that additive growth is allowed without snapshot
        // updates.
        expect(newTools.length).toBeGreaterThanOrEqual(0);
        expect(current.tools.length).toBeGreaterThanOrEqual(snapshot.tools.length);
    });

    it('snapshot file itself is well-formed and exposes all pinned attributes per tool', async () => {
        const snapshot = await readProfiles(SNAPSHOT_PATH);
        expect(typeof snapshot.version).toBe('string');
        expect(Array.isArray(snapshot.tools)).toBe(true);
        expect(snapshot.tools.length).toBeGreaterThan(0);

        for (const tool of snapshot.tools) {
            for (const attr of PINNED_ATTRIBUTES) {
                expect(
                    typeof tool[attr],
                    `snapshot tool entry missing pinned attribute "${attr}": ${JSON.stringify(tool)}`,
                ).toBe('string');
                expect(tool[attr].length).toBeGreaterThan(0);
            }
        }
    });
});
