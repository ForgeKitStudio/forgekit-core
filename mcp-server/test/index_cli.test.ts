/**
 * CLI argument parser tests for @forgekitstudio/core-mcp.
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

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(here, '..');
const ENTRY_POINT = join(SERVER_ROOT, 'dist', 'src', 'index.js');

function requireBuilt(): void {
  if (!existsSync(ENTRY_POINT)) {
    throw new Error(
      `Build artifact missing at ${ENTRY_POINT}. Run \`npm run build\` first.`,
    );
  }
}

describe('parseCliArgs — defaults', () => {
  it('returns default options when argv is empty', () => {
    expect(parseCliArgs([])).toEqual({
      stdio: false,
      profile: 'Full',
      logLevel: 'info',
      licenseDir: undefined,
      smoke: false,
    });
  });
});

describe('parseCliArgs — --stdio', () => {
  it('recognises --stdio as a boolean flag and keeps other defaults', () => {
    expect(parseCliArgs(['--stdio'])).toEqual({
      stdio: true,
      profile: 'Full',
      logLevel: 'info',
      licenseDir: undefined,
      smoke: false,
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
      licenseDir: undefined,
      smoke: false,
    });
  });
});

describe('parseCliArgs — --license-dir', () => {
  it('accepts --license-dir with a space-separated value', () => {
    const opts = parseCliArgs(['--license-dir', '/tmp/licenses']);
    expect(opts.licenseDir).toBe('/tmp/licenses');
  });

  it('accepts --license-dir=<value>', () => {
    const opts = parseCliArgs(['--license-dir=/tmp/licenses']);
    expect(opts.licenseDir).toBe('/tmp/licenses');
  });

  it('defaults --license-dir to undefined when not provided', () => {
    const opts = parseCliArgs([]);
    expect(opts.licenseDir).toBeUndefined();
  });

  it('rejects --license-dir without a value', () => {
    let caught: unknown;
    try {
      parseCliArgs(['--license-dir']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('--license-dir');
  });
});

describe('CLI startup — license unlock logging', () => {
  it('logs [license] unlocked modules: to stderr when --license-dir is empty', async () => {
    requireBuilt();
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'forgekit-cli-empty-'));
    try {
      const res = spawnSync('node', [ENTRY_POINT, '--license-dir', dir], {
        encoding: 'utf8',
        cwd: SERVER_ROOT,
      });
      expect(res.status).toBe(0);
      const stderr = res.stderr ?? '';
      expect(stderr).toContain('[license] unlocked modules:');
      expect(stderr).toContain('[]');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('logs the fifteen RPG subsystem modules when a forgekit_rpg.key file is present', async () => {
    requireBuilt();
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'forgekit-cli-rpg-'));
    try {
      const record = {
        license_id: 'forgekit_rpg',
        activated_at: '2025-01-02T03:04:05',
        fingerprint: 'a'.repeat(64),
      };
      await writeFile(join(dir, 'forgekit_rpg.key'), JSON.stringify(record), 'utf8');
      const res = spawnSync('node', [ENTRY_POINT, '--license-dir', dir], {
        encoding: 'utf8',
        cwd: SERVER_ROOT,
      });
      expect(res.status).toBe(0);
      const stderr = res.stderr ?? '';
      expect(stderr).toContain('[license] unlocked modules:');
      expect(stderr).toContain('combat');
      expect(stderr).toContain('crafting');
      expect(stderr).toContain('inventory');
      expect(stderr).toContain('stats');
      expect(stderr).toContain('effects');
      expect(stderr).toContain('magic');
      expect(stderr).toContain('equipment');
      expect(stderr).toContain('progression');
      expect(stderr).toContain('enemies');
      expect(stderr).toContain('loot');
      expect(stderr).toContain('spawner');
      expect(stderr).toContain('chests');
      expect(stderr).toContain('npc');
      expect(stderr).toContain('dialog');
      expect(stderr).toContain('vendor');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
