/**
 * Tests for the `search.references` MCP tool.
 *
 * `search.references` finds usages of a symbol across `.gd` files in the
 * project. It returns `{refs: [{file, line, preview, context}]}` where
 * `context` is one of:
 *
 *   - `"definition"`: a `func <symbol>(`, `var <symbol>`, `const <symbol>`,
 *     `signal <symbol>(`, or `class_name <symbol>` declaration.
 *   - `"call"`: a call-site `<symbol>(`.
 *   - `"reference"`: any other word-boundary occurrence (`\b<symbol>\b`).
 *
 * The optional `class` parameter narrows the search to files that declare
 * `class_name <class>` or inherit from a file containing that declaration.
 * The parameter is intentionally coarse — it filters the file set before
 * the symbol scan — because GDScript does not have a rich symbol table we
 * can consult from Node.js.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolInputError } from '../../../src/tools/project/errors.js';
import { searchReferences } from '../../../src/tools/search/search_references.js';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'forgekit-search-refs-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function writeGd(relativePath: string, contents: string): Promise<void> {
  const full = join(workspace, relativePath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, contents);
}

describe('searchReferences — locates definitions', () => {
  it('tags `func <symbol>(...)` declarations as "definition"', async () => {
    await writeGd(
      'a.gd',
      ['extends Node', '', 'func foo(x):', '\treturn x', ''].join('\n'),
    );
    const result = await searchReferences({
      projectRoot: workspace,
      symbol: 'foo',
    });
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0].context).toBe('definition');
    expect(result.refs[0].line).toBe(3);
  });

  it('tags `signal <symbol>(...)` declarations as "definition"', async () => {
    await writeGd(
      'game_events.gd',
      [
        'extends Node',
        '',
        'signal damage_dealt(source, target)',
        '',
      ].join('\n'),
    );
    const result = await searchReferences({
      projectRoot: workspace,
      symbol: 'damage_dealt',
    });
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0].context).toBe('definition');
  });

  it('tags `var <symbol>` and `const <symbol>` as "definition"', async () => {
    await writeGd(
      'a.gd',
      ['var my_var = 1', 'const MY_CONST = 2', ''].join('\n'),
    );
    const myVar = await searchReferences({
      projectRoot: workspace,
      symbol: 'my_var',
    });
    expect(myVar.refs[0].context).toBe('definition');

    const myConst = await searchReferences({
      projectRoot: workspace,
      symbol: 'MY_CONST',
    });
    expect(myConst.refs[0].context).toBe('definition');
  });

  it('tags `class_name <symbol>` as "definition"', async () => {
    await writeGd('item.gd', 'class_name ItemResource\nextends Resource\n');
    const result = await searchReferences({
      projectRoot: workspace,
      symbol: 'ItemResource',
    });
    const definitions = result.refs.filter((r) => r.context === 'definition');
    expect(definitions).toHaveLength(1);
    expect(definitions[0].line).toBe(1);
  });
});

describe('searchReferences — locates calls and references', () => {
  it('tags `<symbol>(...)` invocations as "call"', async () => {
    await writeGd('a.gd', 'func foo():\n\tpass\n');
    await writeGd('b.gd', 'func use():\n\tfoo()\n\tfoo(1, 2)\n');
    const result = await searchReferences({
      projectRoot: workspace,
      symbol: 'foo',
    });
    const calls = result.refs.filter((r) => r.context === 'call');
    expect(calls.map((r) => [r.file, r.line])).toEqual([
      ['b.gd', 2],
      ['b.gd', 3],
    ]);
  });

  it('tags non-call, non-definition occurrences as "reference"', async () => {
    await writeGd(
      'a.gd',
      ['var x = MyType', 'func y() -> MyType:', '\treturn null', ''].join('\n'),
    );
    const result = await searchReferences({
      projectRoot: workspace,
      symbol: 'MyType',
    });
    expect(result.refs.every((r) => r.context === 'reference')).toBe(true);
    expect(result.refs.map((r) => r.line)).toEqual([1, 2]);
  });

  it('uses word boundaries so "foo" does not match "foobar"', async () => {
    await writeGd(
      'a.gd',
      [
        'func foo():',
        '\tpass',
        'func foobar():',
        '\tpass',
        'var foo_baz = 1',
        '',
      ].join('\n'),
    );
    const result = await searchReferences({
      projectRoot: workspace,
      symbol: 'foo',
    });
    // Match the `func foo():` definition only — neither `foobar` nor
    // `foo_baz` are word-boundary hits for "foo".
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0].line).toBe(1);
  });
});

describe('searchReferences — class filter', () => {
  it('restricts the scan to files that declare `class_name <class>`', async () => {
    await writeGd('a.gd', 'class_name ItemResource\nvar foo = 1\n');
    await writeGd('b.gd', 'var foo = 1\n');
    const result = await searchReferences({
      projectRoot: workspace,
      symbol: 'foo',
      class: 'ItemResource',
    });
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0].file).toBe('a.gd');
  });
});

describe('searchReferences — scan scope', () => {
  it('only considers .gd files', async () => {
    await writeGd('a.gd', 'func foo():\n\tpass\n');
    await writeGd('b.md', 'foo\n');
    await writeGd('c.txt', 'foo\n');
    const result = await searchReferences({
      projectRoot: workspace,
      symbol: 'foo',
    });
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0].file).toBe('a.gd');
  });

  it('skips .git, .godot, node_modules, dist', async () => {
    await writeGd('.git/config.gd', 'func foo():\n\tpass\n');
    await writeGd('.godot/cache.gd', 'func foo():\n\tpass\n');
    await writeGd('node_modules/pkg/x.gd', 'func foo():\n\tpass\n');
    await writeGd('mcp-server/dist/y.gd', 'func foo():\n\tpass\n');
    await writeGd('addons/a.gd', 'func foo():\n\tpass\n');
    const result = await searchReferences({
      projectRoot: workspace,
      symbol: 'foo',
    });
    expect(result.refs.map((r) => r.file)).toEqual(['addons/a.gd']);
  });
});

describe('searchReferences — validation', () => {
  it('rejects an empty projectRoot', async () => {
    await expect(
      searchReferences({ projectRoot: '', symbol: 'foo' }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects an empty symbol', async () => {
    await expect(
      searchReferences({ projectRoot: workspace, symbol: '' }),
    ).rejects.toThrow(ToolInputError);
  });

  it('rejects a symbol with non-identifier characters', async () => {
    await expect(
      searchReferences({ projectRoot: workspace, symbol: 'a.b' }),
    ).rejects.toThrow(ToolInputError);
    await expect(
      searchReferences({ projectRoot: workspace, symbol: 'a b' }),
    ).rejects.toThrow(ToolInputError);
  });
});
