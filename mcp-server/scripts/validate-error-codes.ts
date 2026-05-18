/**
 * CI lint that walks `mcp-server/src/**\/*.ts`, finds every
 * `throw new CliDispatchError(code, ...)` and
 * `throw new CrossDispatchError(code, ...)` site, and asserts the
 * numeric `code` is registered in `src/dispatcher/error_codes.ts`.
 *
 * The script is structured as three pure exports plus a thin CLI
 * entrypoint:
 *
 *   - `scanSourceForDispatchErrors(source, file, constants)` parses a
 *     single TypeScript source file and returns a list of throw sites.
 *     Numeric literals are resolved directly; identifier references
 *     (e.g. `METHOD_NOT_FOUND`) are resolved against `constants` —
 *     the union of every `const X = -32xxx as const` declaration in
 *     the same file plus any user-supplied overrides.
 *   - `scanProject(srcDir)` walks the project and returns the merged
 *     list of throw sites.
 *   - `validateDispatchErrorCodes(sites)` checks each site against
 *     {@link CANONICAL_ERROR_CODES} and returns either
 *     `{ok: true}` or `{ok: false, violations: [...]}`.
 *
 * Designed to be consumed both as a library (the unit tests above
 * import each helper) and as a CLI from CI (`npm run lint:errors`).
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    CANONICAL_ERROR_CODES,
    isRegisteredErrorCode,
} from '../src/dispatcher/error_codes.js';

/**
 * One detected `throw new (Cli|Cross)DispatchError(code, ...)` site.
 */
export interface DispatchErrorThrowSite {
    /** Absolute or workspace-relative path to the source file. */
    readonly file: string;
    /** 1-indexed line number of the `throw` statement. */
    readonly line: number;
    /** Which constructor the throw used. */
    readonly kind: 'CliDispatchError' | 'CrossDispatchError';
    /** Raw text of the first argument as it appears in source. */
    readonly rawCode: string;
    /** Resolved numeric code or `undefined` when resolution failed. */
    readonly code: number | undefined;
}

/** A single violation surfaced by `validateDispatchErrorCodes`. */
export interface DispatchErrorViolation extends DispatchErrorThrowSite {
    readonly reason: 'UNREGISTERED_CODE' | 'UNRESOLVED_IDENTIFIER';
}

/** Verdict returned by `validateDispatchErrorCodes`. */
export type ValidationResult =
    | { readonly ok: true; readonly violations: readonly [] }
    | { readonly ok: false; readonly violations: readonly DispatchErrorViolation[] };

/**
 * Matches `throw new CliDispatchError(<arg>, ...)` /
 * `throw new CrossDispatchError(<arg>, ...)`. The first argument is
 * captured non-greedily up to the first comma or closing paren so we
 * can tolerate both numeric literals and identifier references; the
 * regex deliberately does not try to handle nested parentheses, which
 * `code` arguments never contain.
 */
const THROW_RE =
    /throw\s+new\s+(CliDispatchError|CrossDispatchError)\s*\(\s*([^,)]+)\s*[,)]/g;

/**
 * Matches `const NAME = -32xxx as const;` and similar shapes used to
 * declare numeric error-code constants.  We accept any leading sign
 * and any base-10 integer; the lint job only resolves the value, it
 * does not enforce a particular numeric range here.
 */
const CONST_RE = /(?:export\s+)?const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(-?\d+)\s*(?:as\s+const)?\s*;/g;

/** Reads the local `const X = -32xxx ...` declarations from a file. */
function collectFileConstants(source: string): Record<string, number> {
    const constants: Record<string, number> = {};
    let match: RegExpExecArray | null;
    CONST_RE.lastIndex = 0;
    while ((match = CONST_RE.exec(source)) !== null) {
        const [, name, raw] = match;
        const value = Number(raw);
        if (Number.isFinite(value)) {
            constants[name] = value;
        }
    }
    return constants;
}

/** Returns the 1-indexed line number for the byte offset `index`. */
function lineForIndex(source: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < source.length; i++) {
        if (source.charCodeAt(i) === 10 /* \n */) line++;
    }
    return line;
}

/**
 * Parses one source file and returns the list of throw sites.
 * `extraConstants` is merged on top of the file-local constants so
 * tests can stub identifier resolutions without rewriting the source.
 */
export function scanSourceForDispatchErrors(
    source: string,
    file: string,
    extraConstants: Record<string, number> = {},
): DispatchErrorThrowSite[] {
    const constants = { ...collectFileConstants(source), ...extraConstants };
    const sites: DispatchErrorThrowSite[] = [];
    let match: RegExpExecArray | null;
    THROW_RE.lastIndex = 0;
    while ((match = THROW_RE.exec(source)) !== null) {
        const kind = match[1] as DispatchErrorThrowSite['kind'];
        const rawCode = match[2].trim();
        const line = lineForIndex(source, match.index);

        let code: number | undefined;
        if (/^-?\d+$/.test(rawCode)) {
            code = Number(rawCode);
        } else if (Object.prototype.hasOwnProperty.call(constants, rawCode)) {
            code = constants[rawCode];
        } else {
            code = undefined;
        }

        sites.push({ file, line, kind, rawCode, code });
    }
    return sites;
}

/**
 * Recursively walks `dir`, returning every `*.ts` file path. Skips
 * common output / dependency directories so the lint stays fast on
 * fresh checkouts.
 */
async function listTypescriptFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    async function walk(current: string): Promise<void> {
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name === 'dist') continue;
            const full = join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.ts')) {
                out.push(full);
            }
        }
    }
    const info = await stat(dir);
    if (!info.isDirectory()) {
        throw new Error(`scanProject: ${dir} is not a directory`);
    }
    await walk(dir);
    out.sort();
    return out;
}

/**
 * Walks `srcDir` and returns the merged list of throw sites across
 * every `.ts` file. Each file's local `const NAME = -32xxx` block is
 * resolved independently (constants do not leak between files).
 */
export async function scanProject(
    srcDir: string,
): Promise<DispatchErrorThrowSite[]> {
    const files = await listTypescriptFiles(srcDir);
    const all: DispatchErrorThrowSite[] = [];
    for (const file of files) {
        const source = await readFile(file, 'utf8');
        // Skip files that only export the helper itself; they cannot
        // throw without importing it, and parsing the helper would
        // produce false positives on its own JSDoc examples.
        if (file.endsWith('error_codes.ts')) continue;
        const sites = scanSourceForDispatchErrors(source, file, {});
        all.push(...sites);
    }
    return all;
}

/**
 * Validates a list of throw sites against the registered codes.
 */
export function validateDispatchErrorCodes(
    sites: readonly DispatchErrorThrowSite[],
): ValidationResult {
    const violations: DispatchErrorViolation[] = [];
    for (const site of sites) {
        if (site.code === undefined) {
            violations.push({ ...site, reason: 'UNRESOLVED_IDENTIFIER' });
            continue;
        }
        if (!isRegisteredErrorCode(site.code)) {
            violations.push({ ...site, reason: 'UNREGISTERED_CODE' });
        }
    }
    if (violations.length === 0) {
        return { ok: true, violations: [] };
    }
    return { ok: false, violations };
}

/**
 * CLI entrypoint. Walks `<repo>/src/` (relative to this script),
 * prints any violations on stderr, and exits non-zero when the
 * dispatch surface is inconsistent.
 */
async function main(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    // After tsc emit, this file lives at `dist/scripts/validate-error-codes.js`,
    // so `../../src` resolves to `<package>/src`. When run from source via
    // a TS loader, the relative path still works because `scripts/` and
    // `src/` are siblings under the package root.
    const srcDir = resolve(here, '..', 'src');
    const sites = await scanProject(srcDir);
    const result = validateDispatchErrorCodes(sites);
    if (result.ok) {
        process.stdout.write(
            `validate-error-codes: scanned ${sites.length} dispatch error sites; all codes are registered.\n`,
        );
        process.stdout.write(
            `validate-error-codes: ${CANONICAL_ERROR_CODES.length} canonical codes registered in error_codes.ts.\n`,
        );
        process.exit(0);
        return;
    }
    process.stderr.write(
        `validate-error-codes: found ${result.violations.length} violation(s):\n`,
    );
    for (const v of result.violations) {
        process.stderr.write(
            `  ${v.file}:${v.line} (${v.kind}) raw=${v.rawCode} reason=${v.reason}\n`,
        );
    }
    process.exit(1);
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
    main().catch((err: unknown) => {
        process.stderr.write(`validate-error-codes: ${String(err)}\n`);
        process.exit(1);
    });
}
