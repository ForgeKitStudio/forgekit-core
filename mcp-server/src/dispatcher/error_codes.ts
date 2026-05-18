/**
 * Single source of truth for JSON-RPC error codes raised by the MCP
 * server's Node-side dispatcher.
 *
 * Every error envelope returned to the client follows the JSON-RPC 2.0
 * shape `{code, message, data}`, where `data` always carries a
 * `suggestion: string` field describing how the operator should react.
 * Callers normalize an error by calling `normalizeError(code, extra)`,
 * which merges `extra` into `data` while preserving the canonical
 * `suggestion` (callers may override the suggestion by supplying one
 * in `extra`).
 *
 * The registry below intentionally includes both:
 *   - the canonical codes mandated by task 8.12.1 of the
 *     action-rpg-starter-kit spec, and
 *   - codes already in production use by adjacent subsystems
 *     (`tools/modules/errors.ts`, `projects/errors.ts`,
 *     `auth_verifier.ts`).
 *
 * Two codes diverge from the literal spec list to avoid breaking
 * pre-existing emitters:
 *   - `-32008` keeps its `tools/modules/errors.ts` meaning
 *     (`CORE_VERSION_UNAVAILABLE`); auth failures continue to use the
 *     pre-existing `-32000 UNAUTHORIZED` envelope from
 *     `auth_verifier.ts` instead of a new `-32008 AUTH_FAILED`.
 *   - `-32015..-32017` keep the `projects/errors.ts` workspace
 *     lifecycle meanings; the new spec codes for `LICENSE_INVALID`,
 *     `PROFILE_TOOL_FILTERED`, and `UNKNOWN_PROFILE` are relocated to
 *     `-32023..-32025` so existing emitters stay valid.
 *
 * The CI lint script `scripts/ci/validate-error-codes.ts` walks every
 * `throw new (Cli|Cross)DispatchError(code, ...)` site and asserts the
 * numeric `code` is registered here. New codes must be added in this
 * file before they can be raised.
 */

/** Public shape of a registry entry. */
export interface ErrorCodeInfo {
    /** Stable machine-readable identifier (UPPER_SNAKE_CASE). */
    readonly name: string;
    /**
     * Human-readable JSON-RPC `message`. Either a free-form sentence
     * (e.g. "Method not found") for the JSON-RPC reserved range or the
     * uppercase token (e.g. "PACKET_TOO_LARGE") for application codes.
     */
    readonly message: string;
    /** Default `data.suggestion` text returned to the client. */
    readonly suggestion: string;
}

/** Internal mutable shape used to build the registry. */
type RegistryRecord = Record<number, ErrorCodeInfo>;

const registry: RegistryRecord = {
    // ---- JSON-RPC 2.0 reserved codes ---------------------------------------
    [-32700]: {
        name: 'PARSE_ERROR',
        message: 'Parse error',
        suggestion:
            'Verify the request body is valid JSON; the server could not parse the framing.',
    },
    [-32600]: {
        name: 'INVALID_REQUEST',
        message: 'Invalid Request',
        suggestion:
            'Ensure the JSON-RPC envelope has jsonrpc:"2.0", a numeric or string id, and a method string.',
    },
    [-32601]: {
        name: 'METHOD_NOT_FOUND',
        message: 'Method not found',
        suggestion:
            'Call tools/list to see the methods registered for the active profile and license set.',
    },
    [-32602]: {
        name: 'INVALID_PARAMS',
        message: 'Invalid params',
        suggestion:
            'Inspect the tool schema (tools/list) and resend the request with the required params.',
    },
    [-32603]: {
        name: 'INTERNAL_ERROR',
        message: 'Internal error',
        suggestion:
            'Retry the request; if the failure persists, capture data.detail and the trace_id and file an issue.',
    },

    // ---- Application codes (-32000 .. -32099) ------------------------------
    [-32000]: {
        name: 'CHANNEL_UNAVAILABLE',
        message: 'channel_unavailable',
        suggestion:
            'Verify the editor or runtime channel is connected (mcp.health) before retrying.',
    },
    [-32001]: {
        name: 'CHANNEL_TIMEOUT',
        message: 'channel_timeout',
        suggestion:
            'The downstream channel did not reply within the timeout; reduce payload size or raise the per-call timeout.',
    },
    [-32002]: {
        name: 'PACKET_TOO_LARGE',
        message: 'PACKET_TOO_LARGE',
        suggestion:
            'Split the request payload; UDP datagrams larger than 65507 bytes are rejected.',
    },
    [-32003]: {
        name: 'UNDO_REDO_FAILED',
        message: 'UNDO_REDO_FAILED',
        suggestion:
            'Reopen the affected scene in the editor and retry; the EditorUndoRedoManager rejected the action.',
    },
    [-32004]: {
        name: 'TRANSACTION_TIMEOUT',
        message: 'TRANSACTION_TIMEOUT',
        suggestion:
            'Open transactions auto-rollback after the configured deadline; call transaction.begin again before retrying.',
    },
    [-32005]: {
        name: 'PACKET_TOO_LARGE_RUNTIME',
        message: 'PACKET_TOO_LARGE',
        suggestion:
            'Split the runtime-bridge request payload; the runtime UDP listener rejects datagrams above 65507 bytes.',
    },
    [-32006]: {
        name: 'CORE_VERSION_MISMATCH',
        message: 'CORE_VERSION_MISMATCH',
        suggestion:
            'Update module.manifest.tres so core_min_version matches the installed Core git tag.',
    },
    [-32007]: {
        name: 'NESTED_TRANSACTION_NOT_ALLOWED',
        message: 'NESTED_TRANSACTION_NOT_ALLOWED',
        suggestion:
            'Commit or roll back the open transaction before calling transaction.begin again.',
    },
    [-32008]: {
        name: 'CORE_VERSION_UNAVAILABLE',
        message: 'CORE_VERSION_UNAVAILABLE',
        suggestion:
            'Verify the projectRoot points to a git checkout with a reachable annotated tag (e.g. v1.2.3) so modules.check_compatibility can resolve core_min_version.',
    },
    [-32009]: {
        name: 'GDSCRIPT_SYNTAX_ERROR',
        message: 'GDSCRIPT_SYNTAX_ERROR',
        suggestion:
            'Fix the reported parse errors before retrying the save; the script was not written to disk.',
    },
    [-32010]: {
        name: 'CORE_BOUNDARY_VIOLATION',
        message: 'CORE_BOUNDARY_VIOLATION',
        suggestion:
            'Target path is read-only; write into addons/forgekit_rpg/ or another non-Core location instead.',
    },
    [-32011]: {
        name: 'MANIFEST_TAG_NOT_FOUND',
        message: 'MANIFEST_TAG_NOT_FOUND',
        suggestion:
            'Update module.manifest.tres so core_min_version points to a tag that exists in the Core repository.',
    },
    [-32012]: {
        name: 'CONTEXT_FILE_STALE',
        message: 'CONTEXT_FILE_STALE',
        suggestion:
            'Regenerate CLAUDE.md and .cursorrules so they reflect the current code paths, then recommit.',
    },
    [-32013]: {
        name: 'CONVENTIONAL_COMMITS_FORMAT_VIOLATION',
        message: 'CONVENTIONAL_COMMITS_FORMAT_VIOLATION',
        suggestion:
            "Rewrite the commit message as '<type>(<scope>): <subject>' per the Conventional Commits 1.0 spec.",
    },
    [-32014]: {
        name: 'PR_TEMPLATE_INCOMPLETE',
        message: 'PR_TEMPLATE_INCOMPLETE',
        suggestion:
            'Populate every required PR template section (Test Report, Gameplay Scenarios, Affected MCP Tools, Breaking Changes) before review.',
    },
    [-32015]: {
        name: 'WORKSPACE_NOT_FOUND',
        message: 'WORKSPACE_NOT_FOUND',
        suggestion:
            'Register the workspace via project.add or pass a workspace_id returned by project.list before retrying.',
    },
    [-32016]: {
        name: 'WORKSPACE_ALREADY_REGISTERED',
        message: 'WORKSPACE_ALREADY_REGISTERED',
        suggestion:
            'Use a different workspace_id, or call project.remove on the existing one before re-registering.',
    },
    [-32017]: {
        name: 'PROJECT_ROOT_ALREADY_REGISTERED',
        message: 'PROJECT_ROOT_ALREADY_REGISTERED',
        suggestion:
            'A workspace is already registered for this projectRoot; reuse its workspace_id instead of registering again.',
    },

    // ---- Legacy codes already in production --------------------------------
    // Multi-project subsystem (`src/projects/errors.ts`). The canonical
    // list reuses -32015/-32016/-32017 above for workspace lifecycle
    // codes; the multi-project subsystem keeps -32018..-32022 to itself.
    [-32018]: {
        name: 'INVALID_PROJECT_ROOT',
        message: 'INVALID_PROJECT_ROOT',
        suggestion:
            'Provide an absolute path to a directory that contains a project.godot file.',
    },
    [-32019]: {
        name: 'WORKSPACE_LIMIT_EXCEEDED',
        message: 'WORKSPACE_LIMIT_EXCEEDED',
        suggestion:
            'Unregister an existing workspace via project.remove before registering a new one.',
    },
    [-32020]: {
        name: 'PORT_RANGE_EXHAUSTED',
        message: 'PORT_RANGE_EXHAUSTED',
        suggestion:
            'Free a port in the affected channel range or widen the configured port pool.',
    },
    [-32021]: {
        name: 'NO_ACTIVE_WORKSPACE',
        message: 'NO_ACTIVE_WORKSPACE',
        suggestion:
            'Register a workspace via project.add or pass --cwd at startup so the server can auto-register a default.',
    },
    [-32022]: {
        name: 'WORKSPACE_ROOT_MISMATCH',
        message: 'WORKSPACE_ROOT_MISMATCH',
        suggestion:
            'Use the registered projectRoot for this workspace_id or call project.remove and re-register.',
    },

    // ---- Codes added by task 8.12.1 (relocated to free slots) -------------
    // The literal spec list assigns -32015/-32016/-32017 to these names;
    // those slots are kept by the multi-project subsystem above so the
    // new license/profile codes are placed at -32023..-32025 instead.
    [-32023]: {
        name: 'LICENSE_INVALID',
        message: 'LICENSE_INVALID',
        suggestion:
            'Activate the module license via modules.activate_license; the current key failed verification or expired.',
    },
    [-32024]: {
        name: 'PROFILE_TOOL_FILTERED',
        message: 'PROFILE_TOOL_FILTERED',
        suggestion:
            'Activate the required module license or switch to a profile that exposes this tool, then call tools/list again.',
    },
    [-32025]: {
        name: 'UNKNOWN_PROFILE',
        message: 'UNKNOWN_PROFILE',
        suggestion:
            'Pass --profile with one of full|lite|minimal|rpg-only or remove the flag to use the default profile.',
    },
};

/**
 * Frozen, ordered list of every numeric error code known to the
 * dispatcher. Used by the CI lint script to validate `throw` sites.
 * Order is "smallest absolute first within each band" so the JSON-RPC
 * reserved range comes before the application range.
 */
export const CANONICAL_ERROR_CODES: ReadonlyArray<number> = Object.freeze(
    [
        -32700,
        -32600,
        -32601,
        -32602,
        -32603,
        -32000,
        -32001,
        -32002,
        -32003,
        -32004,
        -32005,
        -32006,
        -32007,
        -32008,
        -32009,
        -32010,
        -32011,
        -32012,
        -32013,
        -32014,
        -32015,
        -32016,
        -32017,
        -32018,
        -32019,
        -32020,
        -32021,
        -32022,
        -32023,
        -32024,
        -32025,
    ],
);

/** Public read-only view of the registry. */
export const ERROR_CODE_REGISTRY: Readonly<Record<number, ErrorCodeInfo>> = registry;

/** Returns true iff `code` is a registered numeric error code. */
export function isRegisteredErrorCode(code: number): boolean {
    return Object.prototype.hasOwnProperty.call(registry, code);
}

/** Returns the sorted list of registered codes. */
export function listRegisteredErrorCodes(): number[] {
    return [...CANONICAL_ERROR_CODES];
}

/**
 * Returns the registry entry for `code`. Throws when the code is not
 * registered; callers must have added it to the registry first.
 */
export function getErrorInfo(code: number): ErrorCodeInfo {
    const info = registry[code];
    if (info === undefined) {
        throw new Error(`unknown error code: ${code}`);
    }
    return info;
}

/** Shape of a normalized JSON-RPC 2.0 error envelope. */
export interface ErrorEnvelope {
    readonly code: number;
    readonly message: string;
    readonly data: { readonly suggestion: string } & Record<string, unknown>;
}

/**
 * Builds a normalized error envelope for `code`. Merges `extraData`
 * into `data` without mutating the caller's copy. The default
 * `suggestion` from the registry is injected unless `extraData`
 * already defines a `suggestion` field, in which case the caller's
 * value wins.
 */
export function normalizeError(
    code: number,
    extraData: Record<string, unknown> = {},
): ErrorEnvelope {
    const info = getErrorInfo(code);
    const data: Record<string, unknown> = { ...extraData };
    if (typeof data.suggestion !== 'string' || data.suggestion.length === 0) {
        data.suggestion = info.suggestion;
    }
    return {
        code,
        message: info.message,
        data: data as { suggestion: string } & Record<string, unknown>,
    };
}
