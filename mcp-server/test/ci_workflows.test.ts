/**
 * Feature: forgekit, CI workflow presence checks.
 *
 * Validates: Requirements 43.1, 43.2, 43.3, 43.4, 43.5, 43.7, 43.8,
 * 44.1, 46.1
 *
 * CI workflow files live outside of the TypeScript dispatch layer but
 * their presence and key commands are part of the spec surface. This
 * smoke-level test pins down the filenames and commands so a cleanup
 * or refactor cannot silently delete the workflows that the CI gate
 * depends on.
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');

async function readRepoFile(rel: string): Promise<string> {
  return readFile(resolve(REPO_ROOT, rel), 'utf8');
}

async function repoFileExists(rel: string): Promise<boolean> {
  try {
    const s = await stat(resolve(REPO_ROOT, rel));
    return s.isFile();
  } catch {
    return false;
  }
}

describe('CI workflow files — core repo', () => {
  it('ships .github/workflows/ci.yml with the mandatory jobs', async () => {
    expect(await repoFileExists('.github/workflows/ci.yml')).toBe(true);
    const text = await readRepoFile('.github/workflows/ci.yml');

    // Spec 43.1 — triggered on every push and on every pull_request
    expect(text).toMatch(/on:\s*/);
    expect(text).toMatch(/\bpush:/);
    expect(text).toMatch(/\bpull_request:/);

    // Spec 43.2 — installs Godot 4 headless + Node.js
    expect(text).toMatch(/godot/i);
    expect(text).toMatch(/node/i);

    // Spec 43.3 — runs GUT unit tests
    expect(text).toMatch(/gut_cmdln\.gd/);
    expect(text).toMatch(/tests\/unit/);

    // Spec 43.4 — fast-check + CoreFuzz property tests
    expect(text).toMatch(/mcp-server\/test|vitest|fast-check/i);
    expect(text).toMatch(/tests\/property/);

    // Spec 43.5 — check-imports job
    expect(text).toMatch(/check.imports|check_imports/);
  });

  it('ships .github/workflows/release.yml for tag-driven releases', async () => {
    expect(await repoFileExists('.github/workflows/release.yml')).toBe(true);
    const text = await readRepoFile('.github/workflows/release.yml');
    // Spec 43.7 — runs on push tag v*
    expect(text).toMatch(/tags:/);
    expect(text).toMatch(/v\*/);
  });

  it('ships .github/workflows/npm-publish.yml for the mcp-server package', async () => {
    expect(await repoFileExists('.github/workflows/npm-publish.yml')).toBe(true);
    const text = await readRepoFile('.github/workflows/npm-publish.yml');
    // Spec 43.8 — publishes @forgekitstudio/core-mcp on v* tag push
    expect(text).toMatch(/tags:/);
    expect(text).toMatch(/v\*/);
    expect(text).toMatch(/npm publish|@forgekitstudio\/core-mcp/);
  });
});
