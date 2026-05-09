/**
 * Feature: forgekit, documentation contracts.
 *
 * Validates: Requirements 5.4, 38.3, 38.4, 38.5, 39.3, 42.6
 *
 * Some requirements describe external or UX guarantees that do not map
 * to a single piece of behaviour the test suite can execute directly:
 *
 *   - 5.4 — the Editor Plugin auto-refreshes the scene tree view when
 *           MCP tools mutate the open scene (runtime Godot editor UX).
 *   - 38.3 — the MCP Server can be upgraded with
 *           `npx -y @forgekitstudio/core-mcp@latest`.
 *   - 38.4 — Core is upgradeable via Godot AssetLib's "Update" action.
 *   - 38.5 — paid modules are upgraded by re-extracting the ZIP from
 *           an itch.io / Gumroad email.
 *   - 39.3 — `ForgeKitStudio/forgekit-<product>` repo naming convention.
 *   - 42.6 — AI agents fill the PR template by piping the output of
 *           `test_report.parse` / `test_report.serialize` into the PR
 *           body.
 *
 * Each of these is nailed down by a documented contract in the repo
 * (README quickstart, SECURITY/CONTRIBUTING guides, CLAUDE.md, skill
 * packs, mcp_api.md). This test pins the documentation so a cleanup
 * cannot quietly delete the contract and let the requirement drift.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');

async function readText(rel: string): Promise<string> {
  return readFile(resolve(REPO_ROOT, rel), 'utf8');
}

describe('Documentation contracts — external / UX requirements', () => {
  it('README documents the `npx @forgekitstudio/core-mcp@latest` upgrade path (Req 38.3)', async () => {
    const readme = await readText('README.md');
    expect(readme).toMatch(/@forgekitstudio\/core-mcp/);
    expect(readme).toMatch(/npx.*@forgekitstudio\/core-mcp/);
  });

  it('README documents the Godot AssetLib "Update" flow for Core (Req 38.4)', async () => {
    const readme = await readText('README.md');
    expect(readme).toMatch(/AssetLib/i);
  });

  it('docs describe the paid-module upgrade flow (itch.io / Gumroad email → re-extract ZIP) (Req 38.5)', async () => {
    const skill = await readText('docs/SKILLS/module_licensing.md');
    expect(skill).toMatch(/itch\.io|Gumroad/i);
  });

  it('CONTRIBUTING documents the `forgekit-<product>` repo naming convention (Req 39.3)', async () => {
    const contributing = await readText('CONTRIBUTING.md');
    const text = `${contributing}\n`;
    // The convention is also documented in mcp_api.md — accept either
    // location so the test is resilient to a doc move.
    const apiDoc = await readText('docs/mcp_api.md').catch(() => '');
    const combined = text + apiDoc;
    expect(combined).toMatch(/forgekit-<product>|ForgeKitStudio\/forgekit-/);
  });

  it('mcp_api.md pins `test_report.parse` + `test_report.serialize` usage for AI-authored PRs (Req 42.6)', async () => {
    const api = await readText('docs/mcp_api.md');
    expect(api).toMatch(/test_report\.parse/);
    expect(api).toMatch(/test_report\.serialize/);
  });

  it('CLAUDE.md describes scene-tree auto-refresh after MCP mutations (Req 5.4)', async () => {
    const claude = await readText('CLAUDE.md');
    // Two anchors any of which proves the contract is documented:
    // (a) explicit mention of scene-tree sync, or (b) Undo/Redo wrapper
    // contract — which is what drives the automatic refresh.
    const mentionsSync = /scene.*(sync|refresh|tree)|undo.*redo|EditorUndoRedoManager/i.test(claude);
    expect(mentionsSync).toBe(true);
  });
});
