/**
 * Unit tests for the `loadAuthToken()` helper exported from
 * `src/auth_verifier.ts`.
 *
 * These tests pin the contract that {@link EditorWsClient} and
 * {@link RuntimeUdpClient} rely on:
 *   - missing config file → `null` (auth disabled / dev mode)
 *   - empty `auth_token` value → `null`
 *   - non-empty `auth_token` value → the trimmed string
 *   - malformed `auth_token` line (unterminated quote) → throws
 *
 * The end-to-end transport wiring is covered separately by
 * `test/transports/auth.test.ts`; these tests focus on the parser
 * itself so a regression in the `.tres` reader fails fast.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    UNAUTHORIZED_CODE,
    UNAUTHORIZED_MESSAGE,
    loadAuthToken,
    verifyAuthToken,
} from '../src/auth_verifier.js';

describe('verifyAuthToken — module re-exports', () => {
    it('keeps the public constants stable for downstream callers', () => {
        expect(UNAUTHORIZED_CODE).toBe(-32000);
        expect(UNAUTHORIZED_MESSAGE).toBe('UNAUTHORIZED');
    });

    it('still gates request/configured token equality', () => {
        const ok = verifyAuthToken({ requestToken: 'a', configuredToken: 'a' });
        expect(ok.ok).toBe(true);
        const bad = verifyAuthToken({ requestToken: 'a', configuredToken: 'b' });
        expect(bad.ok).toBe(false);
    });
});

describe('loadAuthToken — plugin_config.tres / runtime_config.tres parser', () => {
    let workdir: string;
    let mcpDir: string;

    beforeEach(async () => {
        workdir = await mkdtemp(join(tmpdir(), 'auth-verifier-'));
        mcpDir = join(workdir, 'addons', 'forgekit_core', 'mcp');
        await mkdir(mcpDir, { recursive: true });
    });

    afterEach(async () => {
        await rm(workdir, { recursive: true, force: true });
    });

    it('returns null when the editor config file is missing', async () => {
        const token = await loadAuthToken('editor', { projectRoot: workdir });
        expect(token).toBeNull();
    });

    it('returns null when the runtime config file is missing', async () => {
        const token = await loadAuthToken('runtime', { projectRoot: workdir });
        expect(token).toBeNull();
    });

    it('returns null when auth_token is the empty string', async () => {
        await writeFile(
            join(mcpDir, 'plugin_config.tres'),
            tres('auth_token = ""'),
            'utf8',
        );
        const token = await loadAuthToken('editor', { projectRoot: workdir });
        expect(token).toBeNull();
    });

    it('returns null when the auth_token line is missing entirely', async () => {
        await writeFile(
            join(mcpDir, 'plugin_config.tres'),
            tres('bind_address = "127.0.0.1"\nport = 6010'),
            'utf8',
        );
        const token = await loadAuthToken('editor', { projectRoot: workdir });
        expect(token).toBeNull();
    });

    it('returns the editor token when plugin_config.tres declares one', async () => {
        await writeFile(
            join(mcpDir, 'plugin_config.tres'),
            tres('auth_token = "editor-secret"'),
            'utf8',
        );
        const token = await loadAuthToken('editor', { projectRoot: workdir });
        expect(token).toBe('editor-secret');
    });

    it('returns the runtime token when runtime_config.tres declares one', async () => {
        await writeFile(
            join(mcpDir, 'runtime_config.tres'),
            tres('auth_token = "runtime-secret"'),
            'utf8',
        );
        const token = await loadAuthToken('runtime', { projectRoot: workdir });
        expect(token).toBe('runtime-secret');
    });

    it('keeps editor and runtime tokens independent', async () => {
        await writeFile(
            join(mcpDir, 'plugin_config.tres'),
            tres('auth_token = "editor-token"'),
            'utf8',
        );
        await writeFile(
            join(mcpDir, 'runtime_config.tres'),
            tres('auth_token = "runtime-token"'),
            'utf8',
        );
        const editor = await loadAuthToken('editor', { projectRoot: workdir });
        const runtime = await loadAuthToken('runtime', { projectRoot: workdir });
        expect(editor).toBe('editor-token');
        expect(runtime).toBe('runtime-token');
    });

    it('throws when the auth_token line is malformed (unterminated quote)', async () => {
        await writeFile(
            join(mcpDir, 'plugin_config.tres'),
            tres('auth_token = "missing-closing-quote'),
            'utf8',
        );
        await expect(
            loadAuthToken('editor', { projectRoot: workdir }),
        ).rejects.toThrow(/Malformed auth_token line/);
    });
});

function tres(body: string): string {
    return `[gd_resource type="Resource" load_steps=2 format=3]\n\n[resource]\n${body}\n`;
}
