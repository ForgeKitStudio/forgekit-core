/**
 * Tests for the `search.code` MCP tool.
 *
 * `search.code` performs a regex search across the Godot project and
 * returns `{matches: [{file, line, preview}]}`. The caller supplies:
 *
 *   - `query`: a JavaScript regex source string (no flags) compiled with
 *     the `m` flag so `^`/`$` anchor per line.
 *   - `include`: optional list of glob-like path prefixes (project-relative,
 *     forward slashes). When supplied, only files whose relative path
 *     starts with one of the prefixes are scanned.
 *   - `exclude`: optional list of glob-like path prefixes. Any file whose
 *     relative path starts with one of these prefixes is skipped. Exclude
 *     wins over include when a path matches both.
 *
 * The tool walks the repository under `projectRoot`, skipping the
 * customary Godot / Node.js metadata directories (`.git/`, `.godot/`,
 * `node_modules/`, `dist/`). Every match returns the 1-indexed line
 * number and the full (but trimmed to 200 chars) line text as preview so
 * the caller can triage without re-reading the file.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/project/errors.js';
import { searchCode } from '../../../src/tools/search/search_code.js';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-search-code-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function writeFileIn(
  relativePath: string,
  contents: string,
): Promise<void> {
  const full = join(workspace, relativePath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, contents);
}

describe('searchCode — happy path', () => {
  it('returns matches with file, line, and preview for a literal query', async () => {
    await writeFileIn(
      'addons/forgekit_core/event_bus/game_events.gd',
      [
        'extends Node',
        '',
        'signal damage_dealt(source, target)',
        'signal crafting_completed(recipe_id)',
        '',
      ].join('\n'),
    );
    const result = await searchCode({
      projectRoot: workspace,
      query: 'damage_dealt',
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].file).toBe(
      'addons/forgekit_core/event_bus/game_events.gd',
    );
    expect(result.matches[0].line).toBe(3);
    expect(result.matches[0].preview).toContain('damage_dealt');
  });

  it('returns one match per matching line, ordered by file then line', async () => {
    await writeFileIn(
      'a.gd',
      ['extends Node', 'func foo():', '\tfoo()', '\tfoo()', ''].join('\n'),
    );
    await writeFileIn(
      'b.gd',
      ['extends Node', 'func foo():', '\tpass', ''].join('\n'),
    );
    const result = await searchCode({
      projectRoot: workspace,
      query: 'foo',
    });
    expect(result.matches.map((m) => [m.file, m.line])).toEqual([
      ['a.gd', 2],
      ['a.gd', 3],
      ['a.gd', 4],
      ['b.gd', 2],
    ]);
  });

  it('treats the query as a regex (case-sensitive by default)', async () => {
    await writeFileIn(
      'x.gd',
      ['var Foo = 1', 'var foo = 2', 'var FOO = 3', ''].join('\n'),
    );
    const result = await searchCode({
      projectRoot: workspace,
      query: '\\bfoo\\b',
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].line).toBe(2);
  });

  it('supports character classes and alternation in the regex', async () => {
    await writeFileIn(
      'x.gd',
      ['var a = 1', 'var b = 2', 'var c = 3', 'var d = 4', ''].join('\n'),
    );
    const result = await searchCode({
      projectRoot: workspace,
      query: 'var (a|c) =',
    });
    expect(result.matches.map((m) => m.line)).toEqual([1, 3]);
  });

  it('returns an empty matches array when the query has no hits', async () => {
    await writeFileIn('a.gd', 'extends Node\n');
    const result = await searchCode({
      projectRoot: workspace,
      query: 'no_such_symbol',
    });
    expect(result.matches).toEqual([]);
  });
});

describe('searchCode — include and exclude filters', () => {
  it('restricts scan to include prefixes when supplied', async () => {
    await writeFileIn('addons/forgekit_core/a.gd', 'signal foo\n');
    await writeFileIn('addons/forgekit_rpg/combat/b.gd', 'signal foo\n');
    const result = await searchCode({
      projectRoot: workspace,
      query: 'signal foo',
      include: ['addons/forgekit_core/'],
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].file).toBe('addons/forgekit_core/a.gd');
  });

  it('skips files under exclude prefixes', async () => {
    await writeFileIn('addons/forgekit_core/a.gd', 'signal foo\n');
    await writeFileIn('tests/unit/b.gd', 'signal foo\n');
    const result = await searchCode({
      projectRoot: workspace,
      query: 'signal foo',
      exclude: ['tests/'],
    });
    expect(result.matches.map((m) => m.file)).toEqual([
      'addons/forgekit_core/a.gd',
    ]);
  });

  it('applies exclude on top of include (exclude wins)', async () => {
    await writeFileIn('addons/forgekit_core/a.gd', 'signal foo\n');
    await writeFileIn('addons/forgekit_core/tests/b.gd', 'signal foo\n');
    const result = await searchCode({
      projectRoot: workspace,
      query: 'signal foo',
      include: ['addons/forgekit_core/'],
      exclude: ['addons/forgekit_core/tests/'],
    });
    expect(result.matches.map((m) => m.file)).toEqual([
      'addons/forgekit_core/a.gd',
    ]);
  });
});

describe('searchCode — default skipped directories', () => {
  it('skips .git, .godot, node_modules, and dist by default', async () => {
    await writeFileIn('.git/config', 'signal foo\n');
    await writeFileIn('.godot/cache.gd', 'signal foo\n');
    await writeFileIn('node_modules/pkg/index.gd', 'signal foo\n');
    await writeFileIn('mcp-server/dist/a.gd', 'signal foo\n');
    await writeFileIn('addons/forgekit_core/a.gd', 'signal foo\n');
    const result = await searchCode({
      projectRoot: workspace,
      query: 'signal foo',
    });
    expect(result.matches.map((m) => m.file)).toEqual([
      'addons/forgekit_core/a.gd',
    ]);
  });
});

describe('searchCode — preview shape', () => {
  it('returns the full line as preview when shorter than the truncation limit', async () => {
    await writeFileIn('a.gd', 'signal foo(x, y)\n');
    const result = await searchCode({
      projectRoot: workspace,
      query: 'signal',
    });
    expect(result.matches[0].preview).toBe('signal foo(x, y)');
  });

  it('truncates preview to 200 characters for very long lines', async () => {
    const long = 'signal ' + 'a'.repeat(500);
    await writeFileIn('a.gd', long + '\n');
    const result = await searchCode({
      projectRoot: workspace,
      query: 'signal',
    });
    expect(result.matches[0].preview.length).toBe(200);
  });
});

describe('searchCode — validation', () => {
  it('rejects an empty projectRoot', async () => {
    await expect(
      searchCode({ projectRoot: '', query: 'x' }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty query', async () => {
    await expect(
      searchCode({ projectRoot: workspace, query: '' }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an invalid regex', async () => {
    await expect(
      searchCode({ projectRoot: workspace, query: '[' }),
    ).rejects.toThrow(ToolInputError);
  });
});
