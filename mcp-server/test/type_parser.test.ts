/**
 * Smart_Type_Parser unit tests.
 *
 * The parser is a closed-grammar recursive-descent reader for Godot-style
 * literals. It must never call `eval` or `Function`. Valid literals produce
 * a tagged-union `ParsedValue`; anything outside the grammar must throw
 * `InvalidLiteralError` with the JSON-RPC error code `INVALID_LITERAL`,
 * the offending character position, and the fragment of the input that
 * caused the failure.
 */

import { describe, expect, it } from 'vitest';

import {
  InvalidLiteralError,
  parseEvalSafeExpr,
  parseNodeSetPropertyValue,
  parseValue,
  type ParsedValue,
} from '../src/type_parser.js';

describe('parseValue — numbers', () => {
  it('parses positive integers', () => {
    expect(parseValue('42')).toEqual({ kind: 'number', value: 42 });
  });
  it('parses negative integers', () => {
    expect(parseValue('-7')).toEqual({ kind: 'number', value: -7 });
  });
  it('parses floats', () => {
    expect(parseValue('3.14')).toEqual({ kind: 'number', value: 3.14 });
  });
  it('parses negative floats', () => {
    expect(parseValue('-0.5')).toEqual({ kind: 'number', value: -0.5 });
  });
  it('parses scientific notation', () => {
    expect(parseValue('1e3')).toEqual({ kind: 'number', value: 1000 });
    expect(parseValue('2.5e-2')).toEqual({ kind: 'number', value: 0.025 });
  });
  it('tolerates surrounding whitespace', () => {
    expect(parseValue('   42   ')).toEqual({ kind: 'number', value: 42 });
  });
});

describe('parseValue — booleans and null', () => {
  it('parses true', () => {
    expect(parseValue('true')).toEqual({ kind: 'bool', value: true });
  });
  it('parses false', () => {
    expect(parseValue('false')).toEqual({ kind: 'bool', value: false });
  });
  it('parses null', () => {
    expect(parseValue('null')).toEqual({ kind: 'null' });
  });
});

describe('parseValue — strings', () => {
  it('parses a simple double-quoted string', () => {
    expect(parseValue('"hello"')).toEqual({ kind: 'string', value: 'hello' });
  });
  it('parses escape sequences \\", \\\\, \\n, \\t', () => {
    expect(parseValue('"a\\"b\\\\c\\nd\\te"')).toEqual({
      kind: 'string',
      value: 'a"b\\c\nd\te',
    });
  });
  it('parses an empty string', () => {
    expect(parseValue('""')).toEqual({ kind: 'string', value: '' });
  });
  it('parses strings with Unicode BMP characters directly', () => {
    expect(parseValue('"zażółć gęślą jaźń"')).toEqual({
      kind: 'string',
      value: 'zażółć gęślą jaźń',
    });
  });
  it('parses strings with CJK characters directly', () => {
    expect(parseValue('"日本語テスト"')).toEqual({
      kind: 'string',
      value: '日本語テスト',
    });
  });
  it('parses strings with emoji (surrogate pairs) directly', () => {
    expect(parseValue('"hi 🌲🗡️"')).toEqual({
      kind: 'string',
      value: 'hi 🌲🗡️',
    });
  });
  it('parses \\uXXXX escape sequences', () => {
    // U+00E9 = é, U+1F600 = 😀 (requires surrogate pair in JS source)
    expect(parseValue('"caf\\u00e9"')).toEqual({
      kind: 'string',
      value: 'café',
    });
  });
  it('parses a \\uXXXX escape for a surrogate pair', () => {
    // U+1F600 == \uD83D\uDE00
    expect(parseValue('"\\uD83D\\uDE00"')).toEqual({
      kind: 'string',
      value: '😀',
    });
  });
  it('rejects an unterminated string', () => {
    expect(() => parseValue('"unterminated')).toThrowError(InvalidLiteralError);
  });
  it('rejects an unsupported escape sequence', () => {
    expect(() => parseValue('"\\q"')).toThrowError(InvalidLiteralError);
  });
  it('rejects a malformed \\uXXXX escape', () => {
    expect(() => parseValue('"\\uZZZZ"')).toThrowError(InvalidLiteralError);
  });
});

describe('parseValue — Vector2 / Vector3', () => {
  it('parses Vector2', () => {
    expect(parseValue('Vector2(1, 2)')).toEqual({ kind: 'vector2', x: 1, y: 2 });
  });
  it('parses Vector3 with negative numbers', () => {
    expect(parseValue('Vector3(1, 2, -3)')).toEqual({
      kind: 'vector3',
      x: 1,
      y: 2,
      z: -3,
    });
  });
  it('rejects Vector2 missing a component', () => {
    expect(() => parseValue('Vector2(1,')).toThrowError(InvalidLiteralError);
  });
  it('rejects Vector2 with the wrong arity', () => {
    expect(() => parseValue('Vector2(1, 2, 3)')).toThrowError(InvalidLiteralError);
  });
});

describe('parseValue — Color', () => {
  it('parses Color(r, g, b)', () => {
    expect(parseValue('Color(0.5, 0.25, 0.75)')).toEqual({
      kind: 'color',
      r: 0.5,
      g: 0.25,
      b: 0.75,
      a: 1,
    });
  });
  it('parses Color(r, g, b, a)', () => {
    expect(parseValue('Color(0.5, 0.25, 0.75, 0.1)')).toEqual({
      kind: 'color',
      r: 0.5,
      g: 0.25,
      b: 0.75,
      a: 0.1,
    });
  });
  it('parses #RRGGBB', () => {
    expect(parseValue('#ff0000')).toEqual({
      kind: 'color',
      r: 1,
      g: 0,
      b: 0,
      a: 1,
    });
  });
  it('parses #RRGGBBAA', () => {
    const v = parseValue('#ff000080') as Extract<ParsedValue, { kind: 'color' }>;
    expect(v.kind).toBe('color');
    expect(v.r).toBe(1);
    expect(v.g).toBe(0);
    expect(v.b).toBe(0);
    expect(v.a).toBeCloseTo(128 / 255, 5);
  });
  it('rejects a malformed hex color', () => {
    expect(() => parseValue('#zzzzzz')).toThrowError(InvalidLiteralError);
  });
});

describe('parseValue — Rect2 / Transform2D / Transform3D', () => {
  it('parses Rect2', () => {
    expect(parseValue('Rect2(0, 0, 10, 20)')).toEqual({
      kind: 'rect2',
      x: 0,
      y: 0,
      w: 10,
      h: 20,
    });
  });
  it('parses Transform2D', () => {
    expect(parseValue('Transform2D(1, 0, 0, 1, 5, 6)')).toEqual({
      kind: 'transform2d',
      a00: 1,
      a01: 0,
      a10: 0,
      a11: 1,
      ox: 5,
      oy: 6,
    });
  });
  it('parses Transform3D', () => {
    expect(parseValue('Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 30)')).toEqual({
      kind: 'transform3d',
      xx: 1,
      xy: 0,
      xz: 0,
      yx: 0,
      yy: 1,
      yz: 0,
      zx: 0,
      zy: 0,
      zz: 1,
      ox: 10,
      oy: 20,
      oz: 30,
    });
  });
});

describe('parseValue — arrays', () => {
  it('parses an empty array', () => {
    expect(parseValue('[]')).toEqual({ kind: 'array', items: [] });
  });
  it('parses a flat array of mixed values', () => {
    expect(parseValue('[1, "two", true, null]')).toEqual({
      kind: 'array',
      items: [
        { kind: 'number', value: 1 },
        { kind: 'string', value: 'two' },
        { kind: 'bool', value: true },
        { kind: 'null' },
      ],
    });
  });
  it('parses nested arrays', () => {
    expect(parseValue('[[1, 2], [3, 4]]')).toEqual({
      kind: 'array',
      items: [
        {
          kind: 'array',
          items: [
            { kind: 'number', value: 1 },
            { kind: 'number', value: 2 },
          ],
        },
        {
          kind: 'array',
          items: [
            { kind: 'number', value: 3 },
            { kind: 'number', value: 4 },
          ],
        },
      ],
    });
  });
  it('parses deeply nested arrays up to 4 levels', () => {
    expect(parseValue('[[[[1]]]]')).toEqual({
      kind: 'array',
      items: [
        {
          kind: 'array',
          items: [
            {
              kind: 'array',
              items: [
                {
                  kind: 'array',
                  items: [{ kind: 'number', value: 1 }],
                },
              ],
            },
          ],
        },
      ],
    });
  });
  it('parses an array holding heterogeneous composites', () => {
    expect(parseValue('[Vector2(1, 2), {"k": [true]}, #00ff00]')).toEqual({
      kind: 'array',
      items: [
        { kind: 'vector2', x: 1, y: 2 },
        {
          kind: 'dict',
          entries: [
            {
              key: 'k',
              value: { kind: 'array', items: [{ kind: 'bool', value: true }] },
            },
          ],
        },
        { kind: 'color', r: 0, g: 1, b: 0, a: 1 },
      ],
    });
  });
  it('accepts a trailing comma before ]', () => {
    expect(parseValue('[1, 2,]')).toEqual({
      kind: 'array',
      items: [
        { kind: 'number', value: 1 },
        { kind: 'number', value: 2 },
      ],
    });
  });
  it('rejects an unclosed array', () => {
    expect(() => parseValue('[1, 2,')).toThrowError(InvalidLiteralError);
  });
});

describe('parseValue — dictionaries', () => {
  it('parses an empty dict', () => {
    expect(parseValue('{}')).toEqual({ kind: 'dict', entries: [] });
  });
  it('parses a single-entry dict', () => {
    expect(parseValue('{"a": 1}')).toEqual({
      kind: 'dict',
      entries: [{ key: 'a', value: { kind: 'number', value: 1 } }],
    });
  });
  it('parses a nested dict', () => {
    expect(parseValue('{"pos": Vector2(1, 2), "tags": ["x", "y"]}')).toEqual({
      kind: 'dict',
      entries: [
        { key: 'pos', value: { kind: 'vector2', x: 1, y: 2 } },
        {
          key: 'tags',
          value: {
            kind: 'array',
            items: [
              { kind: 'string', value: 'x' },
              { kind: 'string', value: 'y' },
            ],
          },
        },
      ],
    });
  });
  it('parses a dict-of-dicts', () => {
    expect(
      parseValue('{"outer": {"inner": {"leaf": 42}}}'),
    ).toEqual({
      kind: 'dict',
      entries: [
        {
          key: 'outer',
          value: {
            kind: 'dict',
            entries: [
              {
                key: 'inner',
                value: {
                  kind: 'dict',
                  entries: [
                    { key: 'leaf', value: { kind: 'number', value: 42 } },
                  ],
                },
              },
            ],
          },
        },
      ],
    });
  });
  it('parses a dict with Unicode keys and values', () => {
    expect(parseValue('{"miecz": "日本語", "🗡": "sword"}')).toEqual({
      kind: 'dict',
      entries: [
        { key: 'miecz', value: { kind: 'string', value: '日本語' } },
        { key: '🗡', value: { kind: 'string', value: 'sword' } },
      ],
    });
  });
  it('accepts a trailing comma before }', () => {
    expect(parseValue('{"a": 1,}')).toEqual({
      kind: 'dict',
      entries: [{ key: 'a', value: { kind: 'number', value: 1 } }],
    });
  });
  it('rejects a dict with a non-string key', () => {
    expect(() => parseValue('{1: 2}')).toThrowError(InvalidLiteralError);
  });
});

describe('parseValue — InvalidLiteralError shape', () => {
  it('reports INVALID_LITERAL for an unknown identifier with position and fragment', () => {
    let caught: unknown;
    try {
      parseValue('   DangerousFn(1)');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidLiteralError);
    const err = caught as InvalidLiteralError;
    expect(err.code).toBe('INVALID_LITERAL');
    expect(err.position).toBe(3);
    expect(err.fragment).toBe('DangerousFn');
  });

  it('rejects eval("x") with INVALID_LITERAL', () => {
    let caught: unknown;
    try {
      parseValue('eval("x")');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidLiteralError);
    const err = caught as InvalidLiteralError;
    expect(err.code).toBe('INVALID_LITERAL');
    expect(err.position).toBe(0);
    expect(err.fragment).toBe('eval');
  });

  it('reports the position for a malformed Vector2 tail and a non-empty fragment', () => {
    let caught: unknown;
    try {
      parseValue('Vector2(1,');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidLiteralError);
    const err = caught as InvalidLiteralError;
    expect(err.code).toBe('INVALID_LITERAL');
    expect(typeof err.position).toBe('number');
    expect(err.position).toBeGreaterThanOrEqual(0);
    expect(typeof err.fragment).toBe('string');
  });

  it('rejects trailing garbage after a valid value', () => {
    let caught: unknown;
    try {
      parseValue('42 garbage');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidLiteralError);
    const err = caught as InvalidLiteralError;
    expect(err.code).toBe('INVALID_LITERAL');
    expect(err.fragment).toContain('garbage');
  });

  it('rejects an empty input', () => {
    let caught: unknown;
    try {
      parseValue('');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidLiteralError);
    expect((caught as InvalidLiteralError).code).toBe('INVALID_LITERAL');
  });

  it('rejects an unexpected character with the character in the fragment', () => {
    let caught: unknown;
    try {
      parseValue('@');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidLiteralError);
    const err = caught as InvalidLiteralError;
    expect(err.position).toBe(0);
    expect(err.fragment.length).toBeGreaterThan(0);
  });
});

describe('parseNodeSetPropertyValue — node.set_property integration', () => {
  it('parses a Vector3 literal', () => {
    expect(parseNodeSetPropertyValue('Vector3(12.5, 0, -4)')).toEqual({
      kind: 'vector3',
      x: 12.5,
      y: 0,
      z: -4,
    });
  });

  it('parses a hex color literal', () => {
    expect(parseNodeSetPropertyValue('#00ff00')).toEqual({
      kind: 'color',
      r: 0,
      g: 1,
      b: 0,
      a: 1,
    });
  });

  it('rejects a non-string value with INVALID_LITERAL', () => {
    let caught: unknown;
    try {
      parseNodeSetPropertyValue(42 as unknown as string);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidLiteralError);
    expect((caught as InvalidLiteralError).code).toBe('INVALID_LITERAL');
  });

  it('rejects an expression containing a function call outside the grammar', () => {
    expect(() => parseNodeSetPropertyValue('eval("x")')).toThrowError(
      InvalidLiteralError,
    );
  });
});

describe('parseEvalSafeExpr — runtime.eval_safe integration', () => {
  it('parses a dict of literals', () => {
    expect(
      parseEvalSafeExpr('{"hp": 100, "pos": Vector2(0, 0)}'),
    ).toEqual({
      kind: 'dict',
      entries: [
        { key: 'hp', value: { kind: 'number', value: 100 } },
        { key: 'pos', value: { kind: 'vector2', x: 0, y: 0 } },
      ],
    });
  });

  it('rejects an empty expression', () => {
    expect(() => parseEvalSafeExpr('')).toThrowError(InvalidLiteralError);
  });

  it('rejects a non-string expression with INVALID_LITERAL', () => {
    let caught: unknown;
    try {
      parseEvalSafeExpr(null as unknown as string);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidLiteralError);
    expect((caught as InvalidLiteralError).code).toBe('INVALID_LITERAL');
  });

  it('does not invoke eval or Function under any valid input', () => {
    const fnSpy = globalThis.Function;
    const originalEval = globalThis.eval;
    let evalInvoked = false;
    // Replace eval with a tracer for this test only.
    // The parser must not touch either symbol.
    (globalThis as unknown as { eval: typeof globalThis.eval }).eval = ((
      ..._args: unknown[]
    ) => {
      evalInvoked = true;
      throw new Error('eval must not be called by the parser');
    }) as unknown as typeof globalThis.eval;
    try {
      parseEvalSafeExpr('[1, 2, 3, Vector2(1, 2), {"k": "v"}]');
    } finally {
      (globalThis as unknown as { eval: typeof globalThis.eval }).eval =
        originalEval;
      globalThis.Function = fnSpy;
    }
    expect(evalInvoked).toBe(false);
  });
});
