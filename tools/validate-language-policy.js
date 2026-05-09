/**
 * Language-policy validator for the ForgeKitStudio/forgekit-core public
 * repository. Walks the working tree, scans published files, and fails
 * when it detects content that violates the English-only policy for
 * public artifacts (code, documentation, configuration, metadata).
 *
 * Detection strategy (intentionally simple — the CI job is a safety net,
 * not a full natural-language classifier):
 *   1. Polish diacritics (ą ć ę ł ń ó ś ź ż and the uppercase
 *      counterparts) are flagged on the exact line and column where they
 *      appear.
 *   2. A curated list of high-signal Polish stopwords is matched as
 *      whole words, case-insensitively, so that English substrings such
 *      as "justice" (containing "just") never trigger a false positive.
 *
 * File scoping:
 *   - Excluded trees (.kiro/, .git/, node_modules/, dist/, build/,
 *     .godot/, coverage/, docs/i18n/<lang>/) are never scanned.
 *   - Lock files (package-lock.json) are skipped because they are
 *     machine-generated and may embed vendor-supplied prose.
 *   - Only files with known text extensions or well-known filenames are
 *     scanned; images, audio, archives, and other binary formats are
 *     ignored even if they contain high bytes.
 *
 * Output:
 *   - A JSON report is written to --output (default:
 *     language-policy-violations.json in the current working directory).
 *   - On any violation the CLI writes a human-readable summary to
 *     stderr and exits with code 1 so the `language-policy` GitHub
 *     Actions job fails the build.
 */

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Polish diacritics as a class of 18 code points (9 lowercase + 9
 * uppercase). Matched with the `g` flag so we can iterate over every
 * occurrence in a line.
 */
const POLISH_DIACRITIC_RE = /[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c\u0104\u0106\u0118\u0141\u0143\u00d3\u015a\u0179\u017b]/g;

/**
 * Curated list of high-signal Polish stopwords that would virtually
 * never appear as an identifier or English word in published source
 * code. The list is deliberately short to minimize false positives; the
 * diacritic check above catches most Polish prose anyway. All entries
 * are stored lowercase because matches are case-insensitive.
 */
const POLISH_STOPWORDS = new Set([
    'jest',
    'nie',
    'oraz',
    'tylko',
    'czyli',
    'dlatego',
    'gdzie',
    'tutaj',
    'wtedy',
    'polski',
    'polska',
    'wszystko',
    'jeden',
    'jedna',
    'jedno',
    'sobie',
    'siebie',
    'ciebie',
]);

/**
 * File extensions whose contents are considered published text and
 * therefore subject to the language policy.
 */
const SCANNED_EXTENSIONS = new Set([
    '.md',
    '.gd',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.json',
    '.yml',
    '.yaml',
    '.toml',
    '.gdshader',
    '.sh',
    '.ps1',
    '.tres',
    '.tscn',
    '.cfg',
    '.godot',
    '.css',
    '.html',
]);

/**
 * Extensions that are always skipped regardless of the file name. The
 * explicit list documents intent and avoids accidentally scanning fonts
 * or compressed payloads.
 */
const SKIPPED_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.webp',
    '.ico',
    '.mp4',
    '.mov',
    '.webm',
    '.ogg',
    '.mp3',
    '.wav',
    '.flac',
    '.ttf',
    '.otf',
    '.woff',
    '.woff2',
    '.zip',
    '.gz',
    '.tar',
    '.bin',
    '.pdf',
    '.import',
    '.lock',
]);

/**
 * Known extension-less filenames (and a few dotfiles) that carry
 * English prose and therefore must be scanned even though their path
 * ends without a recognised extension.
 */
const SCANNED_BASENAMES = new Set([
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'NOTICE',
    'NOTICE.md',
    'COPYING',
    'Dockerfile',
    'Makefile',
    '.gitignore',
    '.gitattributes',
    '.cursorrules',
    '.editorconfig',
    '.nvmrc',
    '.npmrc',
]);

/**
 * Basenames that are never scanned. Lock files are machine-generated
 * and frequently contain URLs or provenance strings that would produce
 * noise without adding signal.
 */
const SKIPPED_BASENAMES = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Cargo.lock',
]);

/**
 * Paths that are skipped because they *must* contain non-English
 * fixture strings to exercise the validator and related Unicode
 * handling. Keep this list tight: every entry is a file whose purpose
 * is to test behavior on Polish or other non-ASCII input, so scanning
 * it would always produce false positives.
 *
 * The validator's own CLI (`tools/validate-language-policy.js`) is
 * excluded because it hard-codes the Polish stopword list and
 * diacritic class that the detector relies on.
 *
 * The report output `language-policy-violations.json` is excluded so
 * the validator never flags the characters it just reported.
 */
const FIXTURE_PATH_ALLOWLIST = new Set([
    'mcp-server/test/tools/testing/test_report.test.ts',
    'mcp-server/test/type_parser.test.ts',
    'mcp-server/test/validate_language_policy.test.ts',
    'tools/validate-language-policy.js',
    'language-policy-violations.json',
    'docs/coverage_matrix.md',
]);

/**
 * Normalise a filesystem path to forward-slash form so pattern checks
 * behave the same on POSIX and Windows CI runners.
 */
function toPosix(p) {
    return p.split(path.sep).join('/');
}

/**
 * Return true if the given repository-relative path lives inside a
 * directory that is explicitly carved out of the language-policy scan.
 */
function isExcludedPath(relativePath) {
    const posix = toPosix(relativePath);

    const topLevelSkipped = [
        '.kiro/',
        '.git/',
        '.godot/',
        'node_modules/',
        'dist/',
        'build/',
        'coverage/',
        '.vscode/',
        '.idea/',
    ];
    for (const prefix of topLevelSkipped) {
        if (posix === prefix.slice(0, -1) || posix.startsWith(prefix)) {
            return true;
        }
        // Nested occurrences, for example mcp-server/node_modules/...
        if (posix.includes('/' + prefix)) {
            return true;
        }
    }

    // docs/i18n/<lang>/... — translations are intentionally non-English.
    if (/^docs\/i18n\/[^/]+\//.test(posix)) {
        return true;
    }

    const base = path.basename(posix);
    if (SKIPPED_BASENAMES.has(base)) {
        return true;
    }

    if (FIXTURE_PATH_ALLOWLIST.has(posix)) {
        return true;
    }

    return false;
}

/**
 * Return true if the given path points at content the validator should
 * inspect. Decisions are based purely on the path (extension + known
 * filenames), never on the file contents, so callers can cheaply filter
 * directory listings before any I/O.
 */
function shouldScanFile(filePath) {
    const base = path.basename(filePath);
    if (SCANNED_BASENAMES.has(base)) {
        return true;
    }
    const ext = path.extname(base).toLowerCase();
    if (ext === '') {
        return false;
    }
    if (SKIPPED_EXTENSIONS.has(ext)) {
        return false;
    }
    return SCANNED_EXTENSIONS.has(ext);
}

/**
 * Split a line into `{word, column}` pairs where `word` is a run of
 * Unicode letters (so Polish diacritics stay attached to their word)
 * and `column` is the 1-indexed position of the first character.
 *
 * We use a Unicode-aware regex rather than `\w+` so words such as
 * `łódź` are treated as a single token.
 */
function tokenizeLine(line) {
    const pattern = /[\p{L}]+/gu;
    const tokens = [];
    let match;
    while ((match = pattern.exec(line)) !== null) {
        tokens.push({ word: match[0], column: match.index + 1 });
    }
    return tokens;
}

/**
 * Pure detector. Returns the full list of violations for a single file
 * body without any I/O. Each violation carries the type, the offending
 * character or word, and the 1-indexed line and column so reports
 * remain useful when shown to humans.
 */
function analyzeContent(content) {
    const violations = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;

        // Polish diacritics: report each occurrence separately.
        let diacriticMatch;
        POLISH_DIACRITIC_RE.lastIndex = 0;
        while ((diacriticMatch = POLISH_DIACRITIC_RE.exec(line)) !== null) {
            violations.push({
                type: 'polish_diacritic',
                character: diacriticMatch[0],
                line: lineNumber,
                column: diacriticMatch.index + 1,
            });
        }

        // Stopwords: whole-word match, case insensitive.
        for (const token of tokenizeLine(line)) {
            const lower = token.word.toLowerCase();
            if (POLISH_STOPWORDS.has(lower)) {
                violations.push({
                    type: 'polish_stopword',
                    word: lower,
                    line: lineNumber,
                    column: token.column,
                });
            }
        }
    }

    return violations;
}

/**
 * Recursively enumerate every file below `rootDir`, skipping directories
 * flagged by {@link isExcludedPath}. Returns repository-relative POSIX
 * paths so downstream code can match against stable identifiers.
 */
async function walkDirectory(rootDir) {
    const results = [];

    async function visit(currentDir) {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const absolute = path.join(currentDir, entry.name);
            const relative = toPosix(path.relative(rootDir, absolute));
            if (isExcludedPath(relative)) {
                continue;
            }
            if (entry.isDirectory()) {
                await visit(absolute);
            } else if (entry.isFile()) {
                results.push(relative);
            }
        }
    }

    await visit(rootDir);
    return results;
}

/**
 * Run the validator against a directory tree. Writes the JSON report to
 * `outputPath` and returns an aggregate result that callers (tests and
 * the CLI) can inspect without re-reading the report from disk.
 */
async function runValidator(options) {
    const rootDir = options.rootDir;
    const outputPath = options.outputPath;

    const allPaths = await walkDirectory(rootDir);
    const violations = [];

    for (const relativePath of allPaths) {
        if (!shouldScanFile(relativePath)) {
            continue;
        }
        const absolute = path.join(rootDir, relativePath);
        let content;
        try {
            content = await fs.readFile(absolute, 'utf-8');
        } catch {
            // Unreadable files (permissions, symlink loops, or vanished
            // during the walk) are ignored — the goal is CI coverage, not
            // filesystem forensics.
            continue;
        }
        const fileViolations = analyzeContent(content);
        for (const v of fileViolations) {
            violations.push({ path: relativePath, ...v });
        }
    }

    const result = {
        ok: violations.length === 0,
        violations,
    };

    await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf-8');

    return result;
}

/**
 * Parse a flat `--key value` argv slice into a plain object. Unknown
 * flags are ignored so the CLI stays forward-compatible with future
 * options (e.g. `--verbose`) wired up from the CI job.
 */
function parseArgs(argv) {
    const options = {};
    for (let i = 2; i < argv.length; i++) {
        const token = argv[i];
        if (token === '--root' && argv[i + 1] !== undefined) {
            options.root = argv[i + 1];
            i++;
        } else if (token === '--output' && argv[i + 1] !== undefined) {
            options.output = argv[i + 1];
            i++;
        }
    }
    return options;
}

/**
 * Format a short, CI-friendly summary of the violations. Lists up to
 * `limit` affected paths and truncates the remainder so the job log
 * stays readable even when an entire document went in by mistake.
 */
function formatSummary(result, limit = 20) {
    const paths = new Map();
    for (const v of result.violations) {
        paths.set(v.path, (paths.get(v.path) ?? 0) + 1);
    }
    const entries = Array.from(paths.entries()).slice(0, limit);
    const lines = [];
    lines.push(`language-policy: ${result.violations.length} violation(s) across ${paths.size} file(s):`);
    for (const [p, count] of entries) {
        lines.push(`  - ${p} (${count})`);
    }
    if (paths.size > limit) {
        lines.push(`  ...and ${paths.size - limit} more (see report)`);
    }
    return lines.join('\n') + '\n';
}

/**
 * CLI entrypoint. Thin wrapper around {@link runValidator} that reads
 * options from argv, writes a summary to stderr on failure, and calls
 * the injected `exit` callback with 0 on success or 1 on violations.
 */
async function runCli(argv, io) {
    const args = parseArgs(argv);
    const rootDir = path.resolve(args.root ?? process.cwd());
    const outputPath = path.resolve(
        args.output ?? path.join(rootDir, 'language-policy-violations.json'),
    );

    const result = await runValidator({ rootDir, outputPath });

    if (result.ok) {
        io.exit(0);
        return;
    }

    io.writeStderr(formatSummary(result));
    io.exit(1);
}

module.exports = {
    POLISH_DIACRITIC_RE,
    POLISH_STOPWORDS,
    analyzeContent,
    formatSummary,
    isExcludedPath,
    parseArgs,
    runCli,
    runValidator,
    shouldScanFile,
};

if (require.main === module) {
    runCli(process.argv, {
        writeStdout: (c) => process.stdout.write(c),
        writeStderr: (c) => process.stderr.write(c),
        exit: (code) => process.exit(code),
    }).catch((err) => {
        process.stderr.write(`validate-language-policy: ${err && err.stack ? err.stack : String(err)}\n`);
        process.exit(2);
    });
}
