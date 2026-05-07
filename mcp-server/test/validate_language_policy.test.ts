/**
 * Unit and integration tests for the language-policy validator consumed
 * by the `language-policy` CI job. The validator is a standalone Node.js
 * script (CommonJS, no build step) that scans the public repository and
 * fails when non-English content is detected in published files.
 *
 * Tests exercise:
 *   - Pure detectors for Polish diacritics and stopwords.
 *   - File-scoping predicates (excluded directories, scanned extensions).
 *   - End-to-end scan of a fixture directory through `runValidator`.
 *   - The `runCli` driver with dependency-injected I/O.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  analyzeContent,
  isExcludedPath,
  runCli,
  runValidator,
  shouldScanFile,
} from '../../tools/validate-language-policy.js';

describe('analyzeContent — pure detectors', () => {
  it('returns no violations for an empty string', () => {
    expect(analyzeContent('')).toEqual([]);
  });

  it('returns no violations for plain English prose', () => {
    expect(analyzeContent('Hello world\nThis is a test.')).toEqual([]);
  });

  it('flags each Polish diacritic with a line and column', () => {
    const violations = analyzeContent('Cześć świecie');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toMatchObject({
      type: 'polish_diacritic',
      line: 1,
    });
    expect(typeof violations[0].column).toBe('number');
  });

  it('flags diacritics on their actual line number (1-indexed)', () => {
    const violations = analyzeContent('line one\nline two\nłódź');
    const diacriticViolations = violations.filter(
      (v) => v.type === 'polish_diacritic',
    );
    expect(diacriticViolations.length).toBeGreaterThan(0);
    expect(diacriticViolations.every((v) => v.line === 3)).toBe(true);
  });

  it('flags Polish stopwords as whole-word matches', () => {
    const violations = analyzeContent('to jest test');
    const stopwords = violations.filter((v) => v.type === 'polish_stopword');
    expect(stopwords.length).toBeGreaterThan(0);
    expect(stopwords.some((v) => v.word === 'jest')).toBe(true);
  });

  it('does not flag English words that contain a Polish stopword as a substring', () => {
    // "justice" contains "just" but is not a whole word match for "jest".
    // "nieto" contains "nie" but is not a whole word match for "nie".
    const violations = analyzeContent('justice and nietoperz are words');
    const stopwords = violations.filter((v) => v.type === 'polish_stopword');
    // "nietoperz" embeds "nie" — not a whole-word match, so must not flag.
    expect(stopwords.filter((v) => v.word === 'nie')).toEqual([]);
  });

  it('flags stopwords regardless of casing', () => {
    const violations = analyzeContent('Jest OK');
    const stopwords = violations.filter((v) => v.type === 'polish_stopword');
    expect(stopwords.some((v) => v.word === 'jest')).toBe(true);
  });
});

describe('isExcludedPath', () => {
  it('excludes files under .kiro/', () => {
    expect(isExcludedPath('.kiro/specs/foo.md')).toBe(true);
    expect(isExcludedPath('.kiro/steering/bar.md')).toBe(true);
  });

  it('excludes files under .git/', () => {
    expect(isExcludedPath('.git/config')).toBe(true);
  });

  it('excludes files under node_modules/', () => {
    expect(isExcludedPath('mcp-server/node_modules/ws/index.js')).toBe(true);
  });

  it('excludes files under dist/', () => {
    expect(isExcludedPath('mcp-server/dist/index.js')).toBe(true);
  });

  it('excludes i18n locale directories under docs/', () => {
    expect(isExcludedPath('docs/i18n/pl/README.md')).toBe(true);
    expect(isExcludedPath('docs/i18n/de/CHANGELOG.md')).toBe(true);
  });

  it('excludes package-lock.json (third-party package metadata)', () => {
    expect(isExcludedPath('mcp-server/package-lock.json')).toBe(true);
  });

  it('does not exclude the regular docs/ tree', () => {
    expect(isExcludedPath('docs/README.md')).toBe(false);
    expect(isExcludedPath('docs/SKILLS/authoring_items.md')).toBe(false);
  });

  it('does not exclude top-level project files', () => {
    expect(isExcludedPath('README.md')).toBe(false);
    expect(isExcludedPath('CONTRIBUTING.md')).toBe(false);
    expect(isExcludedPath('LICENSE')).toBe(false);
  });
});

describe('shouldScanFile', () => {
  it('scans Markdown, GDScript, TypeScript, JavaScript, JSON, YAML', () => {
    expect(shouldScanFile('README.md')).toBe(true);
    expect(shouldScanFile('plugin.gd')).toBe(true);
    expect(shouldScanFile('src/index.ts')).toBe(true);
    expect(shouldScanFile('tools/validate-language-policy.js')).toBe(true);
    expect(shouldScanFile('package.json')).toBe(true);
    expect(shouldScanFile('.github/workflows/ci.yml')).toBe(true);
    expect(shouldScanFile('config.yaml')).toBe(true);
  });

  it('scans known well-known files without extensions', () => {
    expect(shouldScanFile('LICENSE')).toBe(true);
    expect(shouldScanFile('CONTRIBUTING.md')).toBe(true);
    expect(shouldScanFile('.gitignore')).toBe(true);
    expect(shouldScanFile('.gitattributes')).toBe(true);
    expect(shouldScanFile('.cursorrules')).toBe(true);
  });

  it('skips binary and image formats', () => {
    expect(shouldScanFile('assets/icon.png')).toBe(false);
    expect(shouldScanFile('demo.mp4')).toBe(false);
    expect(shouldScanFile('sprite.webp')).toBe(false);
    expect(shouldScanFile('audio.ogg')).toBe(false);
  });

  it('skips unknown extensions by default', () => {
    expect(shouldScanFile('data.bin')).toBe(false);
    expect(shouldScanFile('archive.zip')).toBe(false);
  });
});

describe('runValidator — integration', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'forgekit-lang-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('reports ok=true and writes an empty report for English-only content', async () => {
    await writeFile(join(rootDir, 'README.md'), '# Hello\n\nThis is English.\n');
    await writeFile(
      join(rootDir, 'plugin.gd'),
      '# GDScript plugin — all English\nextends Node\n',
    );

    const result = await runValidator({ rootDir, outputPath: join(rootDir, 'report.json') });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);

    const report = JSON.parse(await readFile(join(rootDir, 'report.json'), 'utf-8'));
    expect(report).toEqual({ ok: true, violations: [] });
  });

  it('reports ok=false and lists offending paths when Polish content is present', async () => {
    await writeFile(join(rootDir, 'README.md'), '# Hello\nThis is fine.\n');
    await writeFile(
      join(rootDir, 'NOTES.md'),
      '# Cześć świecie\nto jest test\n',
    );

    const result = await runValidator({ rootDir, outputPath: join(rootDir, 'report.json') });

    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    const paths = new Set(result.violations.map((v) => v.path));
    expect(paths.has('NOTES.md')).toBe(true);
    expect(paths.has('README.md')).toBe(false);
  });

  it('skips files under .kiro/', async () => {
    await mkdir(join(rootDir, '.kiro', 'specs'), { recursive: true });
    await writeFile(
      join(rootDir, '.kiro', 'specs', 'requirements.md'),
      '# Wymagania\nto jest polski\n',
    );

    const result = await runValidator({ rootDir, outputPath: join(rootDir, 'report.json') });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('skips files under docs/i18n/<lang>/', async () => {
    await mkdir(join(rootDir, 'docs', 'i18n', 'pl'), { recursive: true });
    await writeFile(
      join(rootDir, 'docs', 'i18n', 'pl', 'README.md'),
      '# Czytaj\nto jest polska dokumentacja\n',
    );

    const result = await runValidator({ rootDir, outputPath: join(rootDir, 'report.json') });

    expect(result.ok).toBe(true);
  });

  it('skips files under node_modules/', async () => {
    await mkdir(join(rootDir, 'node_modules', 'third-party'), { recursive: true });
    await writeFile(
      join(rootDir, 'node_modules', 'third-party', 'lib.js'),
      '// zażółć gęślą jaźń\n',
    );

    const result = await runValidator({ rootDir, outputPath: join(rootDir, 'report.json') });

    expect(result.ok).toBe(true);
  });

  it('skips binary files even if they contain non-ASCII bytes', async () => {
    await writeFile(join(rootDir, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await runValidator({ rootDir, outputPath: join(rootDir, 'report.json') });
    expect(result.ok).toBe(true);
  });
});

describe('runCli — command-line driver', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'forgekit-lang-cli-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('exits 0 on a clean tree', async () => {
    await writeFile(join(rootDir, 'README.md'), '# Hello\n');
    let exitCode: number | null = null;
    const stderr: string[] = [];

    await runCli(
      ['node', 'validate-language-policy.js', '--root', rootDir, '--output', join(rootDir, 'report.json')],
      {
        writeStdout: () => {},
        writeStderr: (c) => stderr.push(c),
        exit: (c) => {
          exitCode = c;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
  });

  it('exits 1 and summarises violations on stderr when Polish content is found', async () => {
    await writeFile(join(rootDir, 'README.md'), '# Cześć\nto jest test\n');
    let exitCode: number | null = null;
    const stderr: string[] = [];

    await runCli(
      ['node', 'validate-language-policy.js', '--root', rootDir, '--output', join(rootDir, 'report.json')],
      {
        writeStdout: () => {},
        writeStderr: (c) => stderr.push(c),
        exit: (c) => {
          exitCode = c;
        },
      },
    );

    expect(exitCode).toBe(1);
    const combined = stderr.join('');
    expect(combined).toContain('README.md');
    expect(combined.toLowerCase()).toContain('language-policy');

    const report = JSON.parse(await readFile(join(rootDir, 'report.json'), 'utf-8'));
    expect(report.ok).toBe(false);
    expect(report.violations.length).toBeGreaterThan(0);
  });
});
