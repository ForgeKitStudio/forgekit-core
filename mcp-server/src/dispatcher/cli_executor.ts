/**
 * Local CLI executor — `CliChannelExecutor` implementation for the
 * channel router (see `channel_router.ts`).
 *
 * The CLI channel covers tools that run entirely in-process inside the
 * MCP server: spawning `godot --headless` for the testing/QA family,
 * invoking `adb` for the Android family, and reading
 * `export_presets.cfg` for the export family. None of these calls go
 * through the editor (WebSocket) or runtime (UDP) bridges, so the
 * executor can dispatch them directly without IPC.
 *
 * The constructor walks `profiles.json` and registers a handler for
 * every tool tagged `channel: "cli"` whose implementation lives under
 * the directories enumerated by task 8.5.2:
 *
 *   - `src/tools/testing/*`
 *   - `src/tools/android/*`
 *   - `src/tools/export/*`
 *
 * Per the same task, `runtime_bridge/*` is intentionally excluded —
 * tools like `crafting.validate_recipe` are routed via a runtime
 * dispatcher even when their `channel` is tagged `cli`, because their
 * canonical implementation requires the runtime bridge. The router can
 * still detect the missing handler via `hasHandler()` and fail fast
 * rather than silently returning an internal error.
 *
 * Errors thrown by tool implementations are translated into
 * `CliDispatchError`:
 *
 *   - `ToolInputError` and `TestReportParseError` (validation classes
 *     used across the tool families) → JSON-RPC `-32602 Invalid params`
 *   - Errors that already carry a numeric `code` (the convention used
 *     by the `modules.*` family for `MODULE_NOT_FOUND` and friends) →
 *     forwarded verbatim, including any attached `data`.
 *   - Anything else → JSON-RPC `-32603 Internal error`.
 */

import { listPresets, type ListPresetsDeps } from '../tools/export/list_presets.js';
import { runPreset, type RunPresetDeps } from '../tools/export/run_preset.js';
import {
    validatePreset,
    type ValidatePresetDeps,
} from '../tools/export/validate_preset.js';
import { listDevices, type ListDevicesDeps } from '../tools/android/list_devices.js';
import { installApk, type InstallApkDeps } from '../tools/android/install_apk.js';
import { runLogcat, type RunLogcatDeps } from '../tools/android/run_logcat.js';
import { runUnit, type RunUnitDeps } from '../tools/testing/run_unit.js';
import { runSuite, type RunSuiteDeps } from '../tools/testing/run_suite.js';
import {
    runGameplay,
    type RunGameplayDeps,
} from '../tools/testing/run_gameplay.js';
import {
    runProperty,
    type RunPropertyDeps,
} from '../tools/testing/run_property.js';
import type { SpawnAdb } from '../tools/android/spawn_adb.js';
import type { SpawnGodot } from '../tools/testing/spawn_godot.js';
import {
    parseTestReport,
    serializeTestReport,
    TestReportParseError,
} from '../tools/testing/test_report.js';
import type { ProfilesFile } from '../profiles.js';

/**
 * JSON-RPC error envelope thrown by `CliExecutor.invoke`. The outer
 * dispatcher (channel router) catches it, reads `code`, `message`, and
 * `data`, and surfaces them in the JSON-RPC response.
 */
export class CliDispatchError extends Error {
    readonly code: number;
    readonly data?: unknown;

    constructor(code: number, message: string, data?: unknown) {
        super(message);
        this.name = 'CliDispatchError';
        this.code = code;
        if (data !== undefined) {
            this.data = data;
        }
    }
}

/** Method-not-found JSON-RPC code. */
const METHOD_NOT_FOUND = -32601;
/** Invalid params JSON-RPC code. */
const INVALID_PARAMS = -32602;
/** Internal error JSON-RPC code. */
const INTERNAL_ERROR = -32603;

/** A locally-runnable tool that takes free-form params and returns a result. */
type ToolHandler = (params: unknown) => Promise<unknown>;

/**
 * Dependency-injection surface. Every spawn / readFile / writeFile
 * dependency consumed by an underlying tool can be overridden here so
 * the executor remains unit-testable without spawning real child
 * processes or touching real files.
 */
export interface CliExecutorDeps {
    spawnGodot?: SpawnGodot;
    spawnAdb?: SpawnAdb;
    readFile?: (path: string) => Promise<string>;
    writeFile?: (path: string, content: string) => Promise<void>;
    cwd?: () => string;
}

/**
 * In-process executor for cli-channel tools. The router routes every
 * `channel === "cli"` method to `invoke(method, params)`.
 */
export class CliExecutor {
    private readonly handlers: Map<string, ToolHandler>;

    constructor(profiles: ProfilesFile, deps: CliExecutorDeps = {}) {
        this.handlers = new Map();

        // Build the handler factories once. Closing over `deps` keeps the
        // dispatcher free of any per-call wiring overhead and avoids
        // dynamic imports on the hot path.
        const factories = buildHandlerFactories(deps);

        // Walk profiles.json and register a handler for every tool tagged
        // `channel: "cli"` that has a known factory. Tools tagged `cli`
        // without a factory (e.g. `crafting.validate_recipe`, which lives
        // under `runtime_bridge/`) are skipped; the router will surface
        // them as `Method not found` until a future task wires them up.
        for (const tool of profiles.tools) {
            if (tool.channel !== 'cli') continue;
            const factory = factories.get(tool.name);
            if (factory === undefined) continue;
            this.handlers.set(tool.name, factory);
        }
    }

    /** Returns true iff a handler is registered for `method`. */
    hasHandler(method: string): boolean {
        return this.handlers.has(method);
    }

    /** Returns the sorted list of registered tool names. */
    registeredTools(): string[] {
        return [...this.handlers.keys()].sort();
    }

    /**
     * Executes the locally-registered handler for `method`. Throws
     * `CliDispatchError` with an appropriate JSON-RPC code on any
     * failure — never raises an unmapped error.
     */
    async invoke(method: string, params: unknown): Promise<unknown> {
        const handler = this.handlers.get(method);
        if (handler === undefined) {
            throw new CliDispatchError(METHOD_NOT_FOUND, 'Method not found', {
                method,
            });
        }

        try {
            return await handler(params);
        } catch (err) {
            throw mapToolError(err);
        }
    }
}

/**
 * Constructs the static name → handler map. Keeping the factory list
 * in a single function makes it trivial to spot which families ship a
 * handler and which do not — the registration step in `CliExecutor` is
 * just a `profiles.json` walk that re-uses these closures.
 */
function buildHandlerFactories(deps: CliExecutorDeps): Map<string, ToolHandler> {
    const factories = new Map<string, ToolHandler>();

    // ---- testing / QA family ----------------------------------------------
    const testingDeps: RunUnitDeps & RunSuiteDeps & RunGameplayDeps & RunPropertyDeps =
        deps.spawnGodot === undefined ? {} : { spawn: deps.spawnGodot };

    factories.set('tests.run_unit', async (params) =>
        runUnit(params as Parameters<typeof runUnit>[0], testingDeps),
    );
    factories.set('tests.run_suite', async (params) =>
        runSuite(params as Parameters<typeof runSuite>[0], testingDeps),
    );
    factories.set('tests.run_gameplay', async (params) =>
        runGameplay(params as Parameters<typeof runGameplay>[0], testingDeps),
    );
    factories.set('tests.run_property', async (params) =>
        runProperty(params as Parameters<typeof runProperty>[0], testingDeps),
    );

    factories.set('test_report.parse', async (params) => {
        const json = (params as { json?: unknown } | null | undefined)?.json;
        if (typeof json !== 'string') {
            throw new TestReportParseError(
                `"json" must be a string (got ${describeType(json)}).`,
            );
        }
        return parseTestReport(json);
    });

    factories.set('test_report.serialize', async (params) => {
        const report = (params as { report?: unknown } | null | undefined)?.report;
        if (report === null || typeof report !== 'object' || Array.isArray(report)) {
            throw new TestReportParseError(
                `"report" must be an object (got ${describeType(report)}).`,
            );
        }
        return serializeTestReport(report as Parameters<typeof serializeTestReport>[0]);
    });

    // ---- android family ---------------------------------------------------
    const androidDeps: ListDevicesDeps & InstallApkDeps & RunLogcatDeps =
        deps.spawnAdb === undefined ? {} : { spawn: deps.spawnAdb };

    factories.set('android.list_devices', async (params) =>
        listDevices((params ?? {}) as Parameters<typeof listDevices>[0], androidDeps),
    );
    factories.set('android.install_apk', async (params) =>
        installApk(params as Parameters<typeof installApk>[0], androidDeps),
    );
    factories.set('android.run_logcat', async (params) =>
        runLogcat((params ?? {}) as Parameters<typeof runLogcat>[0], androidDeps),
    );

    // ---- export family ----------------------------------------------------
    const exportReadDeps: ListPresetsDeps & ValidatePresetDeps = {};
    if (deps.readFile !== undefined) exportReadDeps.readFile = deps.readFile;
    if (deps.cwd !== undefined) exportReadDeps.cwd = deps.cwd;

    const runPresetDeps: RunPresetDeps = {};
    if (deps.spawnGodot !== undefined) runPresetDeps.spawn = deps.spawnGodot;
    if (deps.writeFile !== undefined) runPresetDeps.writeFile = deps.writeFile;

    factories.set('export.list_presets', async (params) =>
        listPresets(
            (params ?? {}) as Parameters<typeof listPresets>[0],
            exportReadDeps,
        ),
    );
    factories.set('export.validate_preset', async (params) =>
        validatePreset(
            params as Parameters<typeof validatePreset>[0],
            exportReadDeps,
        ),
    );
    factories.set('export.run_preset', async (params) =>
        runPreset(params as Parameters<typeof runPreset>[0], runPresetDeps),
    );

    return factories;
}

/**
 * Maps a raw error thrown by a tool implementation to a
 * `CliDispatchError` with an appropriate JSON-RPC code.
 *
 * Tools across the families use a few overlapping conventions:
 *   - `ToolInputError` carries `code === "INVALID_ARGUMENT"`.
 *   - `TestReportParseError` carries `code === "TEST_REPORT_PARSE_ERROR"`.
 *   - The `modules.*` errors expose a numeric `code` (`-32005`,
 *     `-32006`, ...) and an optional `data` payload — those should
 *     reach the client unchanged.
 */
function mapToolError(err: unknown): CliDispatchError {
    if (err instanceof CliDispatchError) {
        // A nested invoke (or future composite handler) may already have
        // produced a properly-shaped error. Forward it untouched.
        return err;
    }

    if (!(err instanceof Error)) {
        return new CliDispatchError(INTERNAL_ERROR, 'Internal error', {
            detail: String(err),
        });
    }

    const errAsRecord = err as Error & { code?: unknown; data?: unknown };
    const rawCode = errAsRecord.code;
    const rawData = errAsRecord.data;

    // Validation classes use string codes; map both canonical strings to
    // JSON-RPC -32602.
    if (rawCode === 'INVALID_ARGUMENT' || rawCode === 'TEST_REPORT_PARSE_ERROR') {
        return new CliDispatchError(INVALID_PARAMS, 'Invalid params', {
            detail: err.message,
        });
    }

    // Numeric code → forward verbatim (e.g. modules.* family).
    if (typeof rawCode === 'number' && Number.isFinite(rawCode)) {
        return new CliDispatchError(rawCode, err.message, rawData);
    }

    // Anything else (including string codes other than the two above) is
    // surfaced as an internal error, with the original message preserved
    // on `data.detail` so callers can diagnose.
    return new CliDispatchError(INTERNAL_ERROR, 'Internal error', {
        detail: err.message,
    });
}

function describeType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}
