/**
 * CLI argument parser tests for @forgekit/core-mcp.
 *
 * These tests lock down the current flag surface:
 *   --stdio               boolean, default false
 *   --profile <name>      one of Full | Lite | Minimal | RPG-only, default Full
 *   --mcp-log-level <lvl> one of debug | info | warn | error, default info
 *
 * Invalid values must throw an Error whose message lists the allowed set so
 * the caller can exit with an error listing allowed profiles when a value is
 * out of set.
 */

import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../src/index.js';

describe('parseCliArgs — defaults', () => {
  it('returns default options when argv is empty', () => {
    expect(parseCliArgs([])).toEqual({
      stdio: false,
      profile: 'Full',
      logLevel: 'info',
    });
  });
});

describe('parseCliArgs — --stdio', () => {
  it('recognises --stdio as a boolean flag and keeps other defaults', () => {
    expect(parseCliArgs(['--stdio'])).toEqual({
      stdio: true,
      profile: 'Full',
      logLevel: 'info',
    });
  });
});

describe('parseCliArgs — --profile', () => {
  it('accepts Full', () => {
    expect(parseCliArgs(['--profile', 'Full']).profile).toBe('Full');
  });

  it('accepts Lite', () => {
    expect(parseCliArgs(['--profile', 'Lite']).profile).toBe('Lite');
  });

  it('accepts Minimal', () => {
    expect(parseCliArgs(['--profile', 'Minimal']).profile).toBe('Minimal');
  });

  it('accepts RPG-only', () => {
    expect(parseCliArgs(['--profile', 'RPG-only']).profile).toBe('RPG-only');
  });

  it('rejects unknown profile with a message listing all allowed profiles', () => {
    let caught: unknown;
    try {
      parseCliArgs(['--profile', 'Invalid']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('Full');
    expect(message).toContain('Lite');
    expect(message).toContain('Minimal');
    expect(message).toContain('RPG-only');
  });
});

describe('parseCliArgs — --mcp-log-level', () => {
  it('accepts debug', () => {
    expect(parseCliArgs(['--mcp-log-level', 'debug']).logLevel).toBe('debug');
  });

  it('accepts info', () => {
    expect(parseCliArgs(['--mcp-log-level', 'info']).logLevel).toBe('info');
  });

  it('accepts warn', () => {
    expect(parseCliArgs(['--mcp-log-level', 'warn']).logLevel).toBe('warn');
  });

  it('accepts error', () => {
    expect(parseCliArgs(['--mcp-log-level', 'error']).logLevel).toBe('error');
  });

  it('rejects unknown log level with a message listing all valid levels', () => {
    let caught: unknown;
    try {
      parseCliArgs(['--mcp-log-level', 'nonsense']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('debug');
    expect(message).toContain('info');
    expect(message).toContain('warn');
    expect(message).toContain('error');
  });
});

describe('parseCliArgs — combined flags', () => {
  it('parses --stdio, --profile and --mcp-log-level together', () => {
    expect(
      parseCliArgs(['--stdio', '--profile', 'Minimal', '--mcp-log-level', 'debug']),
    ).toEqual({
      stdio: true,
      profile: 'Minimal',
      logLevel: 'debug',
    });
  });
});
