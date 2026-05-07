/**
 * End-to-end CLI validation for `--profile`.
 *
 * Invoking the compiled entrypoint with an unrecognised profile value must:
 *   - exit with a non-zero code,
 *   - write a message to stderr listing every valid profile name,
 *   - make no other side effects (no stdout output).
 *
 * Running with a valid `--profile` value or no flag at all must pass
 * profile validation (the process may still exit zero because the
 * transport bridges are still stubbed).
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(here, '..');
const ENTRY_POINT = join(SERVER_ROOT, 'dist', 'src', 'index.js');

// These tests depend on `npm run build` having compiled the entrypoint.
// Vitest is configured through scripts/tsconfig and does not recompile
// automatically; the tests fail fast with a clear message when dist is
// missing rather than silently skipping.
function requireBuilt(): void {
  if (!existsSync(ENTRY_POINT)) {
    throw new Error(
      `Build artifact missing at ${ENTRY_POINT}. Run \`npm run build\` first.`,
    );
  }
}

describe('CLI --profile validation', () => {
  it('exits non-zero and lists valid profiles when given a bad value', () => {
    requireBuilt();
    const res = spawnSync('node', [ENTRY_POINT, '--profile=BadName'], {
      encoding: 'utf8',
      cwd: SERVER_ROOT,
    });
    expect(res.status).not.toBe(0);
    const stderr = res.stderr ?? '';
    expect(stderr).toContain('Full');
    expect(stderr).toContain('Lite');
    expect(stderr).toContain('Minimal');
    expect(stderr).toContain('RPG-only');
    // Stdout must be empty — stdio mode reserves it for JSON-RPC traffic.
    expect((res.stdout ?? '').trim()).toBe('');
  });

  it('accepts --profile=Full and reaches the stub acknowledgement', () => {
    requireBuilt();
    const res = spawnSync('node', [ENTRY_POINT, '--profile=Full'], {
      encoding: 'utf8',
      cwd: SERVER_ROOT,
    });
    expect(res.status).toBe(0);
  });

  it('accepts --profile Full (space-separated value)', () => {
    requireBuilt();
    const res = spawnSync('node', [ENTRY_POINT, '--profile', 'Full'], {
      encoding: 'utf8',
      cwd: SERVER_ROOT,
    });
    expect(res.status).toBe(0);
  });

  it('uses the default profile when --profile is omitted', () => {
    requireBuilt();
    const res = spawnSync('node', [ENTRY_POINT], {
      encoding: 'utf8',
      cwd: SERVER_ROOT,
    });
    expect(res.status).toBe(0);
  });

  it('accepts every valid profile name', () => {
    requireBuilt();
    for (const p of ['Full', 'Lite', 'Minimal', 'RPG-only']) {
      const res = spawnSync('node', [ENTRY_POINT, `--profile=${p}`], {
        encoding: 'utf8',
        cwd: SERVER_ROOT,
      });
      expect(res.status).toBe(0);
    }
  });
});
