/**
 * Tests for the CliExecutor — the local dispatcher that runs every
 * cli-channel tool in-process (without IPC to the Godot editor or the
 * runtime bridge).
 *
 * The executor implements `CliChannelExecutor` from
 * `src/dispatcher/channel_router.ts`, so the channel router can route
 * calls whose `channel` is `"cli"` to it.
 *
 * Coverage:
 *   - Every tool tagged `channel: "cli"` in `profiles.json` whose impl
 *     lives under `src/tools/testing/`, `src/tools/android/`, or
 *     `src/tools/export/` has a registered handler. (Task 8.5.2
 *     deliberately excludes `src/tools/runtime_bridge/`, so the
 *     editor/runtime-backed `crafting.validate_recipe` is not handled
 *     here.)
 *   - Calling an unknown tool raises a `CliDispatchError` with
 *     JSON-RPC code `-32601` (`Method not found`).
 *   - Happy-path delegation forwards `params` to the underlying
 *     implementation and returns its result verbatim.
 *   - Error mapping:
 *       * `ToolInputError` (`INVALID_ARGUMENT`) maps to `-32602`.
 *       * `TestReportParseError` (`TEST_REPORT_PARSE_ERROR`) maps to
 *         `-32602` (validation of input JSON).
 *       * Errors carrying a numeric `code` (e.g. the modules.* family)
 *         are preserved verbatim.
 *       * Generic errors map to `-32603` (`Internal error`).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
    CliDispatchError,
    CliExecutor,
} from '../../src/dispatcher/cli_executor.js';
import { loadProfiles, type ProfilesFile, type ToolEntry } from '../../src/profiles.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_PROFILES_PATH = resolve(HERE, '..', '..', 'profiles.json');

/**
 * Tools that MUST be registered by the CliExecutor. Limited to the
 * categories enumerated by task 8.5.2 — `runtime_bridge/` is excluded,
 * so `crafting.validate_recipe` is not part of this set.
 */
const EXPECTED_CLI_TOOLS: readonly string[] = [
    'tests.run_unit',
    'tests.run_suite',
    'tests.run_gameplay',
    'tests.run_property',
    'test_report.parse',
    'test_report.serialize',
    'android.list_devices',
    'android.install_apk',
    'android.run_logcat',
    'export.list_presets',
    'export.run_preset',
    'export.validate_preset',
];

function buildProfiles(tools: ToolEntry[]): ProfilesFile {
    return { version: 'test', tools };
}

function asError(value: unknown): CliDispatchError {
    if (!(value instanceof CliDispatchError)) {
        throw new Error(
            `expected CliDispatchError, got ${value instanceof Error ? value.constructor.name : typeof value}`,
        );
    }
    return value;
}

describe('CliExecutor — registration against the real profiles.json', () => {
    it('registers a handler for every expected cli-channel tool', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);
        const executor = new CliExecutor(profiles);

        for (const name of EXPECTED_CLI_TOOLS) {
            expect(executor.hasHandler(name)).toBe(true);
        }
    });

    it('only registers tools whose channel is "cli" in profiles.json', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);
        const executor = new CliExecutor(profiles);

        const channelByName = new Map<string, string>();
        for (const t of profiles.tools) {
            channelByName.set(t.name, t.channel);
        }

        for (const name of executor.registeredTools()) {
            expect(channelByName.get(name)).toBe('cli');
        }
    });

    it('matches every expected tool to a profiles.json entry tagged channel: cli', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);
        const channelByName = new Map<string, string>();
        for (const t of profiles.tools) {
            channelByName.set(t.name, t.channel);
        }

        for (const name of EXPECTED_CLI_TOOLS) {
            expect(channelByName.get(name)).toBe('cli');
        }
    });
});

describe('CliExecutor — unknown method', () => {
    it('rejects with CliDispatchError code -32601 when the method is not registered', async () => {
        const executor = new CliExecutor(buildProfiles([]));

        await expect(executor.invoke('does.not.exist', {})).rejects.toMatchObject({
            code: -32601,
            message: 'Method not found',
        });
    });

    it('attaches the unknown method name to the error data field', async () => {
        const executor = new CliExecutor(buildProfiles([]));

        let caught: unknown;
        try {
            await executor.invoke('does.not.exist', {});
        } catch (err) {
            caught = err;
        }
        const e = asError(caught);
        expect(e.code).toBe(-32601);
        expect(e.data).toEqual({ method: 'does.not.exist' });
    });
});

describe('CliExecutor — happy path delegation', () => {
    it('forwards params to the testing.run_unit implementation and returns its TestReport verbatim', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);

        const reportJson = JSON.stringify({
            run_id: 'run-1',
            timestamp: '2025-01-01T00:00:00Z',
            total: 1,
            passed: 1,
            failed: 0,
            tests: [],
            suggested_action: '',
        });

        const spawnGodot = vi.fn(async (_args: readonly string[]) => ({
            stdout: `${reportJson}\n`,
            stderr: '',
            exitCode: 0,
        }));

        const executor = new CliExecutor(profiles, { spawnGodot });

        const result = await executor.invoke('tests.run_unit', {
            path: 'tests/unit',
        });

        expect(spawnGodot).toHaveBeenCalledTimes(1);
        const args = spawnGodot.mock.calls[0]![0];
        expect(args).toContain('--headless');
        expect(args).toContain('-gdir=tests/unit');
        expect(result).toEqual({
            run_id: 'run-1',
            timestamp: '2025-01-01T00:00:00Z',
            total: 1,
            passed: 1,
            failed: 0,
            tests: [],
            suggested_action: '',
        });
    });

    it('forwards params to android.list_devices and returns the parsed device list', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);

        const spawnAdb = vi.fn(async (_args: readonly string[]) => ({
            stdout:
                'List of devices attached\nemulator-5554\tdevice product:sdk model:Pixel_7 device:emu\n',
            stderr: '',
            exitCode: 0,
        }));

        const executor = new CliExecutor(profiles, { spawnAdb });

        const result = await executor.invoke('android.list_devices', {});

        expect(spawnAdb).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            devices: [
                {
                    serial: 'emulator-5554',
                    state: 'device',
                    model: 'Pixel_7',
                },
            ],
        });
    });

    it('forwards params to test_report.serialize and returns the JSON envelope', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);
        const executor = new CliExecutor(profiles);

        const report = {
            run_id: 'r',
            timestamp: 't',
            total: 0,
            passed: 0,
            failed: 0,
            tests: [],
            suggested_action: '',
        };

        const result = await executor.invoke('test_report.serialize', { report });
        expect(result).toEqual({ json: JSON.stringify(report) });
    });

    it('forwards params to test_report.parse and returns the parsed report', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);
        const executor = new CliExecutor(profiles);

        const json = JSON.stringify({
            run_id: 'r',
            timestamp: 't',
            total: 0,
            passed: 0,
            failed: 0,
            tests: [],
            suggested_action: '',
        });

        const result = await executor.invoke('test_report.parse', { json });
        expect(result).toEqual({
            run_id: 'r',
            timestamp: 't',
            total: 0,
            passed: 0,
            failed: 0,
            tests: [],
            suggested_action: '',
        });
    });
});

describe('CliExecutor — error mapping', () => {
    it('maps ToolInputError (INVALID_ARGUMENT) to JSON-RPC -32602 "Invalid params"', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);
        const executor = new CliExecutor(profiles);

        // tests.run_unit throws ToolInputError when `path` is empty.
        let caught: unknown;
        try {
            await executor.invoke('tests.run_unit', { path: '' });
        } catch (err) {
            caught = err;
        }
        const e = asError(caught);
        expect(e.code).toBe(-32602);
        expect(e.message).toBe('Invalid params');
        // The original validation message is preserved on `data.detail`
        // so callers can show the offending field.
        expect(e.data).toMatchObject({ detail: expect.stringContaining('"path"') });
    });

    it('maps TestReportParseError to JSON-RPC -32602 "Invalid params"', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);
        const executor = new CliExecutor(profiles);

        let caught: unknown;
        try {
            await executor.invoke('test_report.parse', { json: 'not json' });
        } catch (err) {
            caught = err;
        }
        const e = asError(caught);
        expect(e.code).toBe(-32602);
        expect(e.message).toBe('Invalid params');
        expect(e.data).toMatchObject({ detail: expect.stringContaining('invalid JSON') });
    });

    it('maps generic Error to JSON-RPC -32603 "Internal error" with the original message in data.detail', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);

        const spawnGodot = vi.fn(async (_args: readonly string[]) => {
            throw new Error('spawn EACCES /opt/godot');
        });

        const executor = new CliExecutor(profiles, { spawnGodot });

        let caught: unknown;
        try {
            await executor.invoke('tests.run_unit', { path: 'tests/unit' });
        } catch (err) {
            caught = err;
        }
        const e = asError(caught);
        expect(e.code).toBe(-32603);
        expect(e.message).toBe('Internal error');
        expect(e.data).toMatchObject({ detail: 'spawn EACCES /opt/godot' });
    });

    it('preserves a numeric `code` from custom error classes (e.g. ExportPresetsFileMissingError → string code stays internal -32603)', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);

        // export.list_presets throws ExportPresetsFileMissingError when the
        // file is missing. That error carries a string `code`, so the
        // executor maps it to -32603 (no numeric code to preserve).
        const readFile = vi.fn(async (_path: string): Promise<string> => {
            const err: NodeJS.ErrnoException = new Error('ENOENT') as NodeJS.ErrnoException;
            err.code = 'ENOENT';
            throw err;
        });

        const executor = new CliExecutor(profiles, { readFile });

        let caught: unknown;
        try {
            await executor.invoke('export.list_presets', {
                project_root: '/tmp/no-such-project',
            });
        } catch (err) {
            caught = err;
        }
        const e = asError(caught);
        expect(e.code).toBe(-32603);
        expect(e.message).toBe('Internal error');
        expect(e.data).toMatchObject({
            detail: expect.stringContaining('export_presets.cfg'),
        });
    });

    it('preserves numeric `code` and original `data` when the underlying error already carries them', async () => {
        const profiles = await loadProfiles(REAL_PROFILES_PATH);

        // Simulate a tool implementation that throws with a numeric JSON-RPC
        // code (mirrors the modules.* error classes such as
        // ModuleNotFoundError = -32005, LicenseVerificationFailedError =
        // -32006). The executor must forward the code verbatim so the MCP
        // layer can translate it back into a JSON-RPC error envelope.
        class FakeNumericCodeError extends Error {
            readonly code = -32005;
            readonly data = { module_id: 'forgekit_rpg' };
            constructor() {
                super('MODULE_NOT_FOUND');
                this.name = 'FakeNumericCodeError';
            }
        }

        const spawnGodot = vi.fn(async (_args: readonly string[]) => {
            throw new FakeNumericCodeError();
        });

        const executor = new CliExecutor(profiles, { spawnGodot });

        let caught: unknown;
        try {
            await executor.invoke('tests.run_unit', { path: 'tests/unit' });
        } catch (err) {
            caught = err;
        }
        const e = asError(caught);
        expect(e.code).toBe(-32005);
        expect(e.message).toBe('MODULE_NOT_FOUND');
        expect(e.data).toEqual({ module_id: 'forgekit_rpg' });
    });
});
