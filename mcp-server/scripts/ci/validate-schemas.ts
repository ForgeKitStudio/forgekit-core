/**
 * CI validator — confirms that `src/schema/tool_schemas.ts` defines a
 * schema for every tool listed in `profiles.json` and that each schema
 * compiles cleanly through Ajv 8 (JSON Schema Draft 2020-12, strict
 * mode disabled to allow MCP-style schemas with `additionalProperties:
 * true`).
 *
 * The script is wired into the `schema-validation` GitHub Actions job.
 * On failure it emits a JSON-RPC-shaped envelope on stderr (analogous to
 * `scripts/ci/check-pr-template.ts`) so other tooling can parse the
 * failure structurally.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';

import { loadProfiles } from '../../src/profiles.js';
import {
    getToolSchemas,
    listToolSchemaNames,
} from '../../src/schema/tool_schemas.js';

export const ERROR_CODE_SCHEMA_VALIDATION = -32018 as const;
export const ERROR_MESSAGE_SCHEMA_VALIDATION = 'SCHEMA_VALIDATION_FAILED' as const;

export interface ValidateSchemasResult {
    readonly ok: boolean;
    readonly missing: readonly string[];
    readonly extra: readonly string[];
    readonly compileErrors: readonly string[];
}

export interface CliIo {
    writeStdout: (chunk: string) => void;
    writeStderr: (chunk: string) => void;
    exit: (code: number) => void;
}

/**
 * Pure validator. Compares the registered schema names to
 * `profiles.json` and checks that every schema compiles via Ajv.
 */
export async function validateSchemas(
    profilesPath: string,
): Promise<ValidateSchemasResult> {
    const profiles = await loadProfiles(profilesPath);
    const profileNames = new Set(profiles.tools.map((t) => t.name));
    const schemaNames = new Set(listToolSchemaNames());

    const missing = [...profileNames].filter((n) => !schemaNames.has(n)).sort();
    const extra = [...schemaNames].filter((n) => !profileNames.has(n)).sort();

    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const compileErrors: string[] = [];
    for (const [name, schema] of getToolSchemas()) {
        try {
            ajv.compile(schema.inputSchema);
        } catch (err) {
            compileErrors.push(
                `${name}.inputSchema: ${(err as Error).message}`,
            );
        }
        try {
            ajv.compile(schema.outputSchema);
        } catch (err) {
            compileErrors.push(
                `${name}.outputSchema: ${(err as Error).message}`,
            );
        }
    }

    return {
        ok: missing.length === 0 && extra.length === 0 && compileErrors.length === 0,
        missing,
        extra,
        compileErrors,
    };
}

function formatError(result: ValidateSchemasResult): string {
    const payload = {
        jsonrpc: '2.0' as const,
        error: {
            code: ERROR_CODE_SCHEMA_VALIDATION,
            message: ERROR_MESSAGE_SCHEMA_VALIDATION,
            data: {
                missing: result.missing,
                extra: result.extra,
                compile_errors: result.compileErrors,
            },
        },
    };
    return `${JSON.stringify(payload, null, 2)}\n`;
}

/** CLI entrypoint. */
export async function runCli(
    argv: readonly string[],
    io: CliIo,
): Promise<void> {
    const fileFlagIndex = argv.indexOf('--profiles');
    const overridePath =
        fileFlagIndex >= 0 ? argv[fileFlagIndex + 1] : undefined;

    if (fileFlagIndex >= 0 && overridePath === undefined) {
        io.writeStderr('validate-schemas: --profiles requires a path argument\n');
        io.exit(2);
        return;
    }

    const here = dirname(fileURLToPath(import.meta.url));
    // From `dist/scripts/ci/validate-schemas.js` resolve back to
    // `mcp-server/profiles.json`.
    const defaultProfilesPath = resolve(here, '..', '..', '..', 'profiles.json');
    const profilesPath = overridePath ?? defaultProfilesPath;

    let result: ValidateSchemasResult;
    try {
        result = await validateSchemas(profilesPath);
    } catch (err) {
        io.writeStderr(`validate-schemas: ${(err as Error).message}\n`);
        io.exit(1);
        return;
    }

    if (result.ok) {
        const total = listToolSchemaNames().length;
        io.writeStdout(`validate-schemas: OK (${total} tool schemas)\n`);
        io.exit(0);
        return;
    }

    io.writeStderr(formatError(result));
    io.exit(1);
}

const isDirectExecution = (() => {
    const entry = process.argv[1];
    if (entry === undefined) return false;
    try {
        return fileURLToPath(import.meta.url) === entry;
    } catch {
        return false;
    }
})();

if (isDirectExecution) {
    runCli(process.argv, {
        writeStdout: (chunk) => process.stdout.write(chunk),
        writeStderr: (chunk) => process.stderr.write(chunk),
        exit: (code) => process.exit(code),
    }).catch((err: unknown) => {
        process.stderr.write(`validate-schemas: ${String(err)}\n`);
        process.exit(1);
    });
}

// `readFile` is imported for symmetry with sibling CI scripts; reference
// it here so unused-import linting stays happy without removing the
// helper that downstream maintainers may need.
void readFile;
