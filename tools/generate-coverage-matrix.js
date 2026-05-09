#!/usr/bin/env node
/**
 * generate-coverage-matrix.js
 *
 * Walks the Kiro spec directory for `action-rpg-starter-kit`, extracts
 * every numbered requirement and its acceptance criteria, then walks
 * the test tree to find tests that declare which requirements they
 * cover. Emits `docs/coverage_matrix.md` as a Markdown table so that
 * reviewers can see the requirement → test mapping at a glance.
 *
 * Idempotent by construction: the script sorts requirements, criteria,
 * and test-file lists deterministically, so two consecutive runs
 * produce the same output. CI wires this script through
 * `git diff --exit-code` to catch drift when a requirement gains or
 * loses test coverage.
 *
 * Annotation syntax looked up in test files:
 *   * `_Wymagania: 1.2, 3.4` (Polish task-style annotation copied
 *     verbatim from `tasks.md`)
 *   * `Validates: 1.2, 3.4`  (English mirror produced by some tests)
 *   * `Wymagania 1.2, 3.4`   (fallback without the leading colon)
 *   * `Requirements: 1.2, 3.4` (English long form, used by a handful
 *     of property tests)
 *
 * Each annotation can carry a comma- or space-separated list of
 * `<requirement>.<criterion>` tokens; the criterion part is stripped
 * because the matrix groups by requirement. A trailing `_` (the
 * tasks.md convention that wraps requirement references in italic) is
 * tolerated.
 *
 * Requirements with zero covering tests appear at the top of the
 * table with a `❌` flag. Requirements that have at least one covering
 * test appear below with a `✅` flag. Criteria within a requirement
 * are listed in ascending numeric order; covering test files are
 * listed alphabetically, deduplicated, as repository-relative paths.
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Repository root — one level up from `tools/`. */
const REPO_ROOT = resolve(__dirname, '..');

/**
 * Location of the Kiro spec. The spec lives outside the public
 * repository (under `~/.kiro/specs/...`) during development and is
 * synced into the repo for CI visibility. Resolution order:
 *
 *   1. `$FORGEKIT_SPEC_DIR` — explicit override for CI pipelines that
 *      place the spec at a non-standard path.
 *   2. `<repo>/.kiro/specs/action-rpg-starter-kit` — repo-internal
 *      copy, used when the spec is vendored alongside the code.
 *   3. `$HOME/dummy/.kiro/specs/action-rpg-starter-kit` — the local
 *      development layout.
 */
async function resolveSpecDir() {
    const override = process.env.FORGEKIT_SPEC_DIR;
    const candidates = [
        override,
        resolve(REPO_ROOT, '.kiro', 'specs', 'action-rpg-starter-kit'),
        resolve(
            process.env.HOME ?? '',
            'dummy',
            '.kiro',
            'specs',
            'action-rpg-starter-kit',
        ),
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            const s = await stat(candidate);
            if (s.isDirectory()) return candidate;
        } catch {
            // continue
        }
    }
    return null;
}

/** Destination for the generated Markdown. */
const OUTPUT_PATH = resolve(REPO_ROOT, 'docs', 'coverage_matrix.md');

/**
 * Roots scanned for annotated test files. Each entry is a
 * repo-relative directory; all files under it are walked recursively.
 * Empty roots are skipped silently so the tool works on checkouts
 * that do not vendor every test tree.
 */
const TEST_ROOTS = ['tests', 'mcp-server/test'];

/**
 * File-name suffixes considered as test files. Anything else is
 * ignored — `.uid` sibling files, bundled JSON fixtures, dot files.
 */
const TEST_EXTENSIONS = new Set(['.gd', '.ts', '.js']);

// ---------------------------------------------------------------------------
// Requirement parsing
// ---------------------------------------------------------------------------

/**
 * @typedef {{ number: number, title: string, criteria: string[] }} Requirement
 */

const REQUIREMENT_HEADER_RE = /^###\s+Wymaganie\s+(\d+):\s*(.+?)\s*$/;
const CRITERION_RE = /^(\d+)\.\s+(.+?)\s*$/;
const KRYTERIA_HEADER_RE = /^####\s+Kryteria\s+akceptacji\s*$/;

/**
 * Parse `requirements.md` into a sorted array of requirement blocks.
 */
function parseRequirements(text) {
    /** @type {Map<number, Requirement>} */
    const byNumber = new Map();
    /** @type {Requirement | null} */
    let current = null;
    let insideCriteria = false;
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine;
        const reqMatch = REQUIREMENT_HEADER_RE.exec(line);
        if (reqMatch) {
            current = {
                number: Number.parseInt(reqMatch[1], 10),
                title: reqMatch[2],
                criteria: [],
            };
            byNumber.set(current.number, current);
            insideCriteria = false;
            continue;
        }
        if (current === null) continue;
        // A new `###` header that is not a requirement header ends the
        // current block (for example a "## Uwagi" section).
        if (/^##\s+/.test(line) && !/^###\s+/.test(line)) {
            current = null;
            insideCriteria = false;
            continue;
        }
        if (KRYTERIA_HEADER_RE.test(line)) {
            insideCriteria = true;
            continue;
        }
        if (!insideCriteria) continue;
        const critMatch = CRITERION_RE.exec(line);
        if (critMatch) {
            current.criteria.push(critMatch[2]);
        }
    }
    return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

// ---------------------------------------------------------------------------
// Test walker
// ---------------------------------------------------------------------------

async function walk(dir, acc) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            // Skip build outputs and hidden directories.
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
                continue;
            }
            await walk(full, acc);
            continue;
        }
        if (!entry.isFile()) continue;
        const dot = entry.name.lastIndexOf('.');
        if (dot === -1) continue;
        const ext = entry.name.slice(dot);
        if (!TEST_EXTENSIONS.has(ext)) continue;
        acc.push(full);
    }
}

/**
 * Match every annotation form we accept and return the set of
 * `<requirement>.<criterion>` tokens referenced anywhere in the file.
 * Duplicates collapse automatically because `Set` is the container.
 */
const ANNOTATION_PATTERNS = [
    /_Wymagania:\s*([^_\n]+)/g,
    /\bWymagania\s+([0-9][^\n]+)/g,
    /\bValidates:\s*([^\n]+)/g,
    /\bRequirements:\s*([^\n]+)/g,
];

const REF_TOKEN_RE = /\b(\d+)\.(\d+)\b/g;

function extractReferences(text) {
    /** @type {Set<string>} */
    const refs = new Set();
    for (const pattern of ANNOTATION_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            const payload = match[1] ?? '';
            REF_TOKEN_RE.lastIndex = 0;
            for (const token of payload.matchAll(REF_TOKEN_RE)) {
                refs.add(`${token[1]}.${token[2]}`);
            }
        }
    }
    return refs;
}

// ---------------------------------------------------------------------------
// Matrix assembly
// ---------------------------------------------------------------------------

/**
 * @typedef {Map<string, Set<string>>} CoverageMap — key is `N.M`,
 *   value is a set of repo-relative test file paths covering it.
 */

async function buildCoverage() {
    /** @type {CoverageMap} */
    const coverage = new Map();
    const testFiles = [];
    for (const root of TEST_ROOTS) {
        const absRoot = resolve(REPO_ROOT, root);
        try {
            const s = await stat(absRoot);
            if (!s.isDirectory()) continue;
        } catch {
            continue;
        }
        await walk(absRoot, testFiles);
    }
    for (const file of testFiles) {
        const text = await readFile(file, 'utf8');
        const refs = extractReferences(text);
        if (refs.size === 0) continue;
        const rel = relative(REPO_ROOT, file).split(sep).join('/');
        for (const ref of refs) {
            let bucket = coverage.get(ref);
            if (bucket === undefined) {
                bucket = new Set();
                coverage.set(ref, bucket);
            }
            bucket.add(rel);
        }
    }
    return coverage;
}

/**
 * Render the Markdown table. Requirements with zero coverage appear
 * at the top (❌), then requirements with at least one covering test
 * (✅). Criteria are listed in ascending numeric order; test files
 * are sorted alphabetically.
 */
function render(requirements, coverage) {
    const rows = [];
    for (const req of requirements) {
        const criteriaCount = req.criteria.length;
        const coveredCount = req.criteria.reduce((acc, _text, i) => {
            const ref = `${req.number}.${i + 1}`;
            return acc + (coverage.has(ref) ? 1 : 0);
        }, 0);
        const fullyCovered =
            criteriaCount > 0 && coveredCount === criteriaCount;
        const uncovered = coveredCount === 0;
        rows.push({
            requirement: req,
            fullyCovered,
            uncovered,
        });
    }
    // Sort: fully-uncovered first, then the rest by requirement number.
    rows.sort((a, b) => {
        if (a.uncovered !== b.uncovered) return a.uncovered ? -1 : 1;
        return a.requirement.number - b.requirement.number;
    });

    const lines = [];
    lines.push('# Coverage Matrix');
    lines.push('');
    lines.push(
        'Requirement ↔ test mapping generated by `tools/generate-coverage-matrix.js`.',
    );
    lines.push(
        'Do not edit this file by hand — CI regenerates it on every push and',
    );
    lines.push('fails when the output drifts from the committed version.');
    lines.push('');
    lines.push(
        'Requirements with zero covering tests appear at the top with a ❌',
    );
    lines.push('flag. Requirements with at least one covering test per');
    lines.push('criterion appear below with a ✅ flag; partially covered');
    lines.push('requirements receive a ⚠️ flag.');
    lines.push('');
    lines.push('| Flag | Requirement | Criterion | Test files covering it |');
    lines.push('| :--- | :---------- | :-------- | :--------------------- |');
    for (const row of rows) {
        const { requirement: req, fullyCovered, uncovered } = row;
        const flag = uncovered ? '❌' : fullyCovered ? '✅' : '⚠️';
        const titleCell = `Req ${req.number} — ${escapePipe(req.title)}`;
        if (req.criteria.length === 0) {
            lines.push(
                `| ${flag} | ${titleCell} | _(no acceptance criteria)_ | _(none)_ |`,
            );
            continue;
        }
        for (let i = 0; i < req.criteria.length; i++) {
            const ref = `${req.number}.${i + 1}`;
            const text = req.criteria[i];
            const bucket = coverage.get(ref);
            const files =
                bucket === undefined || bucket.size === 0
                    ? '_(none)_'
                    : [...bucket]
                        .sort((a, b) => a.localeCompare(b))
                        .map((f) => `\`${f}\``)
                        .join('<br>');
            const rowFlag =
                bucket === undefined || bucket.size === 0 ? '❌' : '✅';
            lines.push(
                `| ${rowFlag} | ${titleCell} | ${ref} — ${escapePipe(shorten(text))} | ${files} |`,
            );
        }
    }
    lines.push('');
    return lines.join('\n');
}

function escapePipe(text) {
    return text.replace(/\|/g, '\\|');
}

/**
 * Trim acceptance-criterion text to keep table rows scannable. We
 * keep the first ~160 characters because individual criteria can run
 * several sentences long.
 */
function shorten(text) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 160) return normalized;
    return normalized.slice(0, 157).trimEnd() + '…';
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
    const specDir = await resolveSpecDir();
    if (specDir === null) {
        console.error(
            'generate-coverage-matrix: could not locate the Kiro spec directory.',
        );
        console.error('  Set FORGEKIT_SPEC_DIR to the absolute path of');
        console.error('  the `action-rpg-starter-kit` spec or vendor it at');
        console.error('  <repo>/.kiro/specs/action-rpg-starter-kit/.');
        process.exit(2);
    }
    const requirementsPath = join(specDir, 'requirements.md');
    const requirementsText = await readFile(requirementsPath, 'utf8');
    const requirements = parseRequirements(requirementsText);
    if (requirements.length === 0) {
        console.error(
            `generate-coverage-matrix: no "### Wymaganie N" headers found in ${requirementsPath}.`,
        );
        process.exit(2);
    }
    const coverage = await buildCoverage();
    const markdown = render(requirements, coverage);
    await writeFile(OUTPUT_PATH, markdown + '\n', 'utf8');
    const covered = [...coverage.keys()].length;
    const total = requirements.reduce((a, r) => a + r.criteria.length, 0);
    console.log(
        `generate-coverage-matrix: wrote ${relative(REPO_ROOT, OUTPUT_PATH)} — ` +
        `${covered}/${total} criteria covered across ${requirements.length} requirements.`,
    );
}

main().catch((err) => {
    console.error('generate-coverage-matrix: unexpected failure');
    console.error(err);
    process.exit(1);
});
