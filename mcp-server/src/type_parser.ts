/**
 * Smart_Type_Parser — a closed-grammar reader for Godot-style literals.
 *
 * Used by the MCP server to translate string `value` arguments coming from
 * LLM clients into strongly-typed data. Never invokes `eval` or
 * `Function`: values are constructed by a hand-written lexer + recursive
 * descent parser.
 *
 * Grammar:
 *   value      := literal | ident-call | hex-color | array | dict
 *   literal    := number | string | 'true' | 'false' | 'null'
 *   ident-call := IDENT '(' number-list ')'   -- IDENT ∈ {Vector2, Vector3,
 *                                                 Color, Rect2, Transform2D,
 *                                                 Transform3D}
 *   hex-color  := '#' 6HEX | '#' 8HEX
 *   array      := '[' (value (',' value)* ','?)? ']'
 *   dict       := '{' (string ':' value (',' string ':' value)* ','?)? '}'
 *
 * Every failure mode — malformed input, unknown identifier, trailing
 * garbage, non-string argument — surfaces as an `InvalidLiteralError`
 * with the JSON-RPC error code `INVALID_LITERAL`, the character position
 * where the parser stopped, and the fragment of input that caused the
 * failure. The dispatcher forwards the code, position, and fragment to
 * the client without modification.
 */

export type ParsedValue =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'vector2'; x: number; y: number }
  | { kind: 'vector3'; x: number; y: number; z: number }
  | { kind: 'color'; r: number; g: number; b: number; a: number }
  | { kind: 'rect2'; x: number; y: number; w: number; h: number }
  | {
      kind: 'transform2d';
      a00: number;
      a01: number;
      a10: number;
      a11: number;
      ox: number;
      oy: number;
    }
  | {
      kind: 'transform3d';
      xx: number;
      xy: number;
      xz: number;
      yx: number;
      yy: number;
      yz: number;
      zx: number;
      zy: number;
      zz: number;
      ox: number;
      oy: number;
      oz: number;
    }
  | { kind: 'array'; items: ParsedValue[] }
  | { kind: 'dict'; entries: Array<{ key: string; value: ParsedValue }> };

/**
 * Single error raised by the parser for every grammar violation. Wraps the
 * JSON-RPC code `INVALID_LITERAL` with the character position where the
 * parser stopped and a fragment (≤ 40 chars) of the input around that
 * position so clients can point the user at the problem.
 */
export class InvalidLiteralError extends Error {
  readonly code = 'INVALID_LITERAL';
  readonly position: number;
  readonly fragment: string;

  constructor(reason: string, position: number, fragment: string) {
    super(`INVALID_LITERAL at position ${position}: ${reason} (near "${fragment}").`);
    this.name = 'InvalidLiteralError';
    this.position = position;
    this.fragment = fragment;
  }
}

const FRAGMENT_MAX = 40;

function makeFragment(source: string, position: number, length = 0): string {
  if (source.length === 0) {
    return '';
  }
  const start = Math.max(0, Math.min(position, source.length));
  const end = Math.min(source.length, start + Math.max(length, 1));
  const slice = source.slice(start, end);
  if (slice.length === 0 && start > 0) {
    // End-of-input: show up to FRAGMENT_MAX chars ending at `start`.
    return source.slice(Math.max(0, start - FRAGMENT_MAX), start);
  }
  return slice.slice(0, FRAGMENT_MAX);
}

function fail(
  source: string,
  position: number,
  length: number,
  reason: string,
): never {
  throw new InvalidLiteralError(reason, position, makeFragment(source, position, length));
}

type TokenKind =
  | 'number'
  | 'string'
  | 'ident'
  | 'hex-color'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'lbrace'
  | 'rbrace'
  | 'comma'
  | 'colon';

interface Token {
  kind: TokenKind;
  value: string;
  position: number;
  length: number;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function isHexDigit(ch: string): boolean {
  return (
    (ch >= '0' && ch <= '9') ||
    (ch >= 'a' && ch <= 'f') ||
    (ch >= 'A' && ch <= 'F')
  );
}

function readStringLiteral(source: string, start: number): { value: string; end: number } {
  let i = start + 1; // skip opening quote
  const n = source.length;
  let buf = '';
  while (i < n) {
    const c = source[i];
    if (c === '\\') {
      if (i + 1 >= n) {
        fail(source, i, 1, 'unterminated escape sequence.');
      }
      const esc = source[i + 1];
      switch (esc) {
        case '"':
          buf += '"';
          i += 2;
          continue;
        case '\\':
          buf += '\\';
          i += 2;
          continue;
        case '/':
          buf += '/';
          i += 2;
          continue;
        case 'n':
          buf += '\n';
          i += 2;
          continue;
        case 't':
          buf += '\t';
          i += 2;
          continue;
        case 'r':
          buf += '\r';
          i += 2;
          continue;
        case 'b':
          buf += '\b';
          i += 2;
          continue;
        case 'f':
          buf += '\f';
          i += 2;
          continue;
        case 'u': {
          if (i + 6 > n) {
            fail(source, i, 2, 'truncated \\u escape sequence.');
          }
          const hex = source.slice(i + 2, i + 6);
          for (const h of hex) {
            if (!isHexDigit(h)) {
              fail(source, i, 6, `invalid \\u escape "${hex}".`);
            }
          }
          buf += String.fromCharCode(Number.parseInt(hex, 16));
          i += 6;
          continue;
        }
        default:
          fail(source, i, 2, `unsupported escape "\\${esc}".`);
      }
    }
    if (c === '"') {
      return { value: buf, end: i + 1 };
    }
    buf += c;
    i++;
  }
  fail(source, start, 1, 'unterminated string literal.');
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    const single: Partial<Record<string, TokenKind>> = {
      '(': 'lparen',
      ')': 'rparen',
      '[': 'lbracket',
      ']': 'rbracket',
      '{': 'lbrace',
      '}': 'rbrace',
      ',': 'comma',
      ':': 'colon',
    };
    const singleKind = single[ch];
    if (singleKind !== undefined) {
      tokens.push({ kind: singleKind, value: ch, position: i, length: 1 });
      i++;
      continue;
    }

    if (ch === '"') {
      const start = i;
      const { value, end } = readStringLiteral(source, start);
      tokens.push({ kind: 'string', value, position: start, length: end - start });
      i = end;
      continue;
    }

    if (ch === '#') {
      const start = i;
      i++;
      let buf = '';
      while (i < n && isHexDigit(source[i])) {
        buf += source[i];
        i++;
      }
      if (buf.length !== 6 && buf.length !== 8) {
        fail(
          source,
          start,
          i - start,
          `hex color must have 6 or 8 digits, got ${buf.length}.`,
        );
      }
      tokens.push({ kind: 'hex-color', value: buf, position: start, length: i - start });
      continue;
    }

    if (ch === '-' || ch === '+' || isDigit(ch)) {
      const start = i;
      let buf = '';
      if (ch === '-' || ch === '+') {
        buf += ch;
        i++;
      }
      let sawDigit = false;
      while (i < n && isDigit(source[i])) {
        buf += source[i];
        i++;
        sawDigit = true;
      }
      if (i < n && source[i] === '.') {
        buf += '.';
        i++;
        while (i < n && isDigit(source[i])) {
          buf += source[i];
          i++;
          sawDigit = true;
        }
      }
      if (i < n && (source[i] === 'e' || source[i] === 'E')) {
        buf += source[i];
        i++;
        if (i < n && (source[i] === '+' || source[i] === '-')) {
          buf += source[i];
          i++;
        }
        let sawExpDigit = false;
        while (i < n && isDigit(source[i])) {
          buf += source[i];
          i++;
          sawExpDigit = true;
        }
        if (!sawExpDigit) {
          fail(source, start, i - start, 'exponent has no digits.');
        }
      }
      if (!sawDigit) {
        fail(source, start, i - start, 'expected a digit.');
      }
      tokens.push({ kind: 'number', value: buf, position: start, length: i - start });
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      let buf = '';
      while (i < n && isIdentPart(source[i])) {
        buf += source[i];
        i++;
      }
      tokens.push({ kind: 'ident', value: buf, position: start, length: i - start });
      continue;
    }

    fail(source, i, 1, `unexpected character "${ch}".`);
  }

  return tokens;
}

interface Cursor {
  tokens: Token[];
  index: number;
  source: string;
}

function peek(c: Cursor): Token | null {
  return c.index < c.tokens.length ? c.tokens[c.index] : null;
}

function consume(c: Cursor): Token {
  if (c.index >= c.tokens.length) {
    fail(c.source, c.source.length, 0, 'unexpected end of input.');
  }
  return c.tokens[c.index++];
}

function expect(c: Cursor, kind: TokenKind): Token {
  const t = peek(c);
  if (t === null) {
    fail(c.source, c.source.length, 0, `expected ${kind} but input ended.`);
  }
  if (t.kind !== kind) {
    fail(
      c.source,
      t.position,
      t.length,
      `expected ${kind} but got ${t.kind} ("${t.value}").`,
    );
  }
  return consume(c);
}

function parseNumberToken(c: Cursor, tok: Token): number {
  const v = Number(tok.value);
  if (!Number.isFinite(v)) {
    fail(c.source, tok.position, tok.length, `"${tok.value}" is not a finite number.`);
  }
  return v;
}

function parseNumberList(c: Cursor, openPos: number): number[] {
  const numbers: number[] = [];
  // caller already consumed '('
  if (peek(c)?.kind === 'rparen') {
    consume(c);
    return numbers;
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const t = peek(c);
    if (t === null) {
      fail(c.source, openPos, 1, 'unterminated argument list.');
    }
    if (t.kind !== 'number') {
      fail(
        c.source,
        t.position,
        t.length,
        `expected number but got ${t.kind} ("${t.value}").`,
      );
    }
    consume(c);
    numbers.push(parseNumberToken(c, t));
    const next = peek(c);
    if (next === null) {
      fail(c.source, openPos, 1, 'unterminated argument list.');
    }
    if (next.kind === 'comma') {
      consume(c);
      continue;
    }
    if (next.kind === 'rparen') {
      consume(c);
      return numbers;
    }
    fail(
      c.source,
      next.position,
      next.length,
      `expected ',' or ')' but got ${next.kind} ("${next.value}").`,
    );
  }
}

const IDENT_ARITY: Record<string, number | number[]> = {
  Vector2: 2,
  Vector3: 3,
  Color: [3, 4],
  Rect2: 4,
  Transform2D: 6,
  Transform3D: 12,
};

function buildIdentCall(
  c: Cursor,
  name: string,
  args: number[],
  position: number,
  length: number,
): ParsedValue {
  const expected = IDENT_ARITY[name];
  const arityOk = Array.isArray(expected)
    ? expected.includes(args.length)
    : args.length === expected;
  if (!arityOk) {
    fail(
      c.source,
      position,
      length,
      `${name} expects ${Array.isArray(expected) ? expected.join(' or ') : expected} arguments, got ${args.length}.`,
    );
  }

  switch (name) {
    case 'Vector2':
      return { kind: 'vector2', x: args[0], y: args[1] };
    case 'Vector3':
      return { kind: 'vector3', x: args[0], y: args[1], z: args[2] };
    case 'Color':
      return {
        kind: 'color',
        r: args[0],
        g: args[1],
        b: args[2],
        a: args.length === 4 ? args[3] : 1,
      };
    case 'Rect2':
      return { kind: 'rect2', x: args[0], y: args[1], w: args[2], h: args[3] };
    case 'Transform2D':
      return {
        kind: 'transform2d',
        a00: args[0],
        a01: args[1],
        a10: args[2],
        a11: args[3],
        ox: args[4],
        oy: args[5],
      };
    case 'Transform3D':
      return {
        kind: 'transform3d',
        xx: args[0],
        xy: args[1],
        xz: args[2],
        yx: args[3],
        yy: args[4],
        yz: args[5],
        zx: args[6],
        zy: args[7],
        zz: args[8],
        ox: args[9],
        oy: args[10],
        oz: args[11],
      };
    default:
      // Unreachable because callers filter to known identifiers.
      fail(c.source, position, length, `unknown identifier "${name}".`);
  }
}

function hexPairToFloat(hex: string): number {
  return Number.parseInt(hex, 16) / 255;
}

function parseValueFromCursor(c: Cursor): ParsedValue {
  const t = peek(c);
  if (t === null) {
    fail(c.source, c.source.length, 0, 'expected a value but input ended.');
  }

  switch (t.kind) {
    case 'number':
      consume(c);
      return { kind: 'number', value: parseNumberToken(c, t) };

    case 'string':
      consume(c);
      return { kind: 'string', value: t.value };

    case 'hex-color': {
      consume(c);
      const v = t.value;
      const r = hexPairToFloat(v.slice(0, 2));
      const g = hexPairToFloat(v.slice(2, 4));
      const b = hexPairToFloat(v.slice(4, 6));
      const a = v.length === 8 ? hexPairToFloat(v.slice(6, 8)) : 1;
      return { kind: 'color', r, g, b, a };
    }

    case 'ident': {
      consume(c);
      if (t.value === 'true') {
        return { kind: 'bool', value: true };
      }
      if (t.value === 'false') {
        return { kind: 'bool', value: false };
      }
      if (t.value === 'null') {
        return { kind: 'null' };
      }
      if (Object.prototype.hasOwnProperty.call(IDENT_ARITY, t.value)) {
        const open = peek(c);
        if (open === null || open.kind !== 'lparen') {
          fail(
            c.source,
            open?.position ?? t.position,
            open?.length ?? t.length,
            `expected '(' after ${t.value}.`,
          );
        }
        consume(c);
        const args = parseNumberList(c, open.position);
        return buildIdentCall(c, t.value, args, t.position, t.length);
      }
      fail(c.source, t.position, t.length, `unknown identifier "${t.value}".`);
    }

    case 'lbracket':
      return parseArray(c);

    case 'lbrace':
      return parseDict(c);

    default:
      fail(
        c.source,
        t.position,
        t.length,
        `unexpected token ${t.kind} ("${t.value}").`,
      );
  }
}

function parseArray(c: Cursor): ParsedValue {
  const open = expect(c, 'lbracket');
  const items: ParsedValue[] = [];
  if (peek(c)?.kind === 'rbracket') {
    consume(c);
    return { kind: 'array', items };
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    items.push(parseValueFromCursor(c));
    const next = peek(c);
    if (next === null) {
      fail(c.source, open.position, 1, 'unterminated array.');
    }
    if (next.kind === 'comma') {
      consume(c);
      // Allow trailing comma before ']'.
      if (peek(c)?.kind === 'rbracket') {
        consume(c);
        return { kind: 'array', items };
      }
      continue;
    }
    if (next.kind === 'rbracket') {
      consume(c);
      return { kind: 'array', items };
    }
    fail(
      c.source,
      next.position,
      next.length,
      `expected ',' or ']' but got ${next.kind} ("${next.value}").`,
    );
  }
}

function parseDict(c: Cursor): ParsedValue {
  const open = expect(c, 'lbrace');
  const entries: Array<{ key: string; value: ParsedValue }> = [];
  if (peek(c)?.kind === 'rbrace') {
    consume(c);
    return { kind: 'dict', entries };
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const keyTok = peek(c);
    if (keyTok === null) {
      fail(c.source, open.position, 1, 'unterminated dict.');
    }
    if (keyTok.kind !== 'string') {
      fail(
        c.source,
        keyTok.position,
        keyTok.length,
        `dict keys must be strings, got ${keyTok.kind} ("${keyTok.value}").`,
      );
    }
    consume(c);
    expect(c, 'colon');
    const value = parseValueFromCursor(c);
    entries.push({ key: keyTok.value, value });

    const next = peek(c);
    if (next === null) {
      fail(c.source, open.position, 1, 'unterminated dict.');
    }
    if (next.kind === 'comma') {
      consume(c);
      if (peek(c)?.kind === 'rbrace') {
        consume(c);
        return { kind: 'dict', entries };
      }
      continue;
    }
    if (next.kind === 'rbrace') {
      consume(c);
      return { kind: 'dict', entries };
    }
    fail(
      c.source,
      next.position,
      next.length,
      `expected ',' or '}' but got ${next.kind} ("${next.value}").`,
    );
  }
}

/**
 * Parses `source` as a single closed-grammar literal. Every failure mode
 * (malformed token, unknown identifier, trailing garbage, empty input) is
 * surfaced as `InvalidLiteralError`.
 */
export function parseValue(source: string): ParsedValue {
  if (typeof source !== 'string') {
    throw new InvalidLiteralError(
      `expected a string but got ${typeof source}.`,
      0,
      '',
    );
  }
  const tokens = tokenize(source);
  if (tokens.length === 0) {
    throw new InvalidLiteralError('empty input.', 0, makeFragment(source, 0));
  }
  const cursor: Cursor = { tokens, index: 0, source };
  const value = parseValueFromCursor(cursor);
  if (cursor.index !== tokens.length) {
    const remaining = tokens[cursor.index];
    fail(
      source,
      remaining.position,
      source.length - remaining.position,
      `trailing input: ${remaining.kind} ("${remaining.value}").`,
    );
  }
  return value;
}

/**
 * Parses the `value` parameter of `node.set_property`. The tool contract
 * requires a string literal in the closed grammar; any other shape is
 * surfaced as `INVALID_LITERAL` so the dispatcher returns the same error
 * as for other grammar violations.
 */
export function parseNodeSetPropertyValue(raw: unknown): ParsedValue {
  if (typeof raw !== 'string') {
    throw new InvalidLiteralError(
      `node.set_property "value" must be a string, got ${typeof raw}.`,
      0,
      '',
    );
  }
  return parseValue(raw);
}

/**
 * Parses the `expr` parameter of `runtime.eval_safe`. Delegates to the
 * same closed grammar; exposed as a named entry point so the runtime
 * bridge (UDP transport) cannot accidentally reach into any other code
 * path that might call `eval`.
 */
export function parseEvalSafeExpr(raw: unknown): ParsedValue {
  if (typeof raw !== 'string') {
    throw new InvalidLiteralError(
      `runtime.eval_safe "expr" must be a string, got ${typeof raw}.`,
      0,
      '',
    );
  }
  return parseValue(raw);
}
