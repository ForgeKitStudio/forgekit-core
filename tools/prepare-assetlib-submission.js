#!/usr/bin/env node
/**
 * prepare-assetlib-submission.js
 *
 * Reads `addons/forgekit_core/plugin.cfg`, optionally the latest
 * GitHub Release URL for the current plugin version, and prints a
 * ready-to-paste payload for the Godot AssetLib submission form at
 * https://godotengine.org/asset-library/asset/submit.
 *
 * AssetLib submissions are a manual web form — this helper does not
 * POST anywhere. It only normalises the fields the operator needs to
 * paste: title, description, version, minimum Godot version,
 * download URL, issue tracker URL, repository URL, and the preview
 * image list. The form maintains the asset on its own server once
 * the submission is accepted; subsequent updates use AssetLib's
 * "Update this asset" flow rather than a fresh submission.
 *
 * Usage:
 *   node tools/prepare-assetlib-submission.js
 *   node tools/prepare-assetlib-submission.js --version 0.7.0
 *   node tools/prepare-assetlib-submission.js --format json
 *
 * Flags:
 *   --plugin-cfg <path>   Override the plugin.cfg location.
 *   --version <string>    Override the plugin version (useful when
 *                         cutting a release tag that has not yet
 *                         been written to plugin.cfg).
 *   --release-url <url>   Override the release URL instead of
 *                         assembling it from `owner/repo/tag`.
 *   --owner <name>        GitHub owner (default ForgeKitStudio).
 *   --repo <name>         GitHub repository (default forgekit-core).
 *   --tag <string>        Git tag to embed in the download URL
 *                         (default `v<plugin.version>`).
 *   --format <text|json>  Output format (default `text`).
 *
 * The script does not touch the network. Anything that requires a
 * live GitHub lookup (for example verifying that the release exists)
 * should happen in CI or manually before submission.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   pluginCfg: string | null,
 *   version: string | null,
 *   releaseUrl: string | null,
 *   owner: string,
 *   repo: string,
 *   tag: string | null,
 *   format: 'text' | 'json',
 * }} CliOptions
 */

const HELP_FLAGS = new Set(['--help', '-h']);

function parseArgs(argv) {
    /** @type {CliOptions} */
    const options = {
        pluginCfg: null,
        version: null,
        releaseUrl: null,
        owner: 'ForgeKitStudio',
        repo: 'forgekit-core',
        tag: null,
        format: 'text',
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (HELP_FLAGS.has(arg)) {
            return { help: true };
        }
        const next = () => {
            if (i + 1 >= argv.length) {
                throw new Error(`Missing value for ${arg}.`);
            }
            i += 1;
            return argv[i];
        };
        switch (arg) {
            case '--plugin-cfg':
                options.pluginCfg = next();
                break;
            case '--version':
                options.version = next();
                break;
            case '--release-url':
                options.releaseUrl = next();
                break;
            case '--owner':
                options.owner = next();
                break;
            case '--repo':
                options.repo = next();
                break;
            case '--tag':
                options.tag = next();
                break;
            case '--format': {
                const raw = next();
                if (raw !== 'text' && raw !== 'json') {
                    throw new Error(
                        `--format must be "text" or "json" (got ${JSON.stringify(raw)}).`,
                    );
                }
                options.format = raw;
                break;
            }
            default:
                throw new Error(`Unknown flag ${JSON.stringify(arg)}.`);
        }
    }
    return { help: false, options };
}

// ---------------------------------------------------------------------------
// plugin.cfg parsing
// ---------------------------------------------------------------------------

/**
 * Pull a `key="value"` pair from the `[plugin]` section.
 *
 * `plugin.cfg` is a Godot INI file with the shape used by other
 * plugins: every field quoted. We do not reach for a full INI
 * parser — the file is small and the quoted-string contract is
 * stable across Godot releases.
 */
function extractField(source, key) {
    const pattern = new RegExp(
        `^\\s*${key}\\s*=\\s*"([^"]*)"\\s*$`,
        'm',
    );
    const match = pattern.exec(source);
    if (match === null) return null;
    return match[1];
}

async function readPluginCfg(pathArg) {
    const __filename = fileURLToPath(import.meta.url);
    const repoRoot = resolve(dirname(__filename), '..');
    const target =
        pathArg ?? join(repoRoot, 'addons', 'forgekit_core', 'plugin.cfg');
    const source = await readFile(target, 'utf8');
    const name = extractField(source, 'name');
    const description = extractField(source, 'description');
    const version = extractField(source, 'version');
    const author = extractField(source, 'author');
    if (name === null || version === null) {
        throw new Error(
            `Failed to parse ${target}: missing "name" or "version" key.`,
        );
    }
    return { name, description: description ?? '', version, author: author ?? '' };
}

// ---------------------------------------------------------------------------
// Payload assembly
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   title: string,
 *   version: string,
 *   godot_version: string,
 *   description: string,
 *   author: string,
 *   download_url: string,
 *   download_provider: string,
 *   download_commit: string,
 *   browse_url: string,
 *   issues_url: string,
 *   category: string,
 *   support_level: string,
 *   license: string,
 *   previews: string[],
 *   notes: string[],
 * }} AssetLibPayload
 */

function assemblePayload(pluginCfg, options) {
    const version = options.version ?? pluginCfg.version;
    const tag = options.tag ?? `v${version}`;
    const owner = options.owner;
    const repo = options.repo;
    const downloadUrl =
        options.releaseUrl ??
        `https://github.com/${owner}/${repo}/archive/refs/tags/${tag}.zip`;
    const browseUrl = `https://github.com/${owner}/${repo}`;
    const issuesUrl = `${browseUrl}/issues`;

    return {
        title: 'ForgeKit Core',
        version,
        // Godot AssetLib tracks the minimum engine version separately
        // from the package version. We support 4.3+ at the source level
        // (see README); CI tests 4.6.2 but the addon does not need 4.6
        // features to parse.
        godot_version: '4.3',
        description:
            pluginCfg.description ||
            'Modular AI-native starter kit for Godot 4.x. Event bus, base resources, MCP runtime bridge, and a Node.js MCP server so LLM agents can author scenes and drive a running game through a stable tool surface.',
        author: pluginCfg.author || 'ForgeKitStudio',
        download_url: downloadUrl,
        download_provider: 'GitHub',
        download_commit: tag,
        browse_url: browseUrl,
        issues_url: issuesUrl,
        category: 'Tools',
        support_level: 'Community',
        license: 'MIT',
        previews: [
            // AssetLib previews are URLs to images. Populate once the
            // marketing screenshots land under `docs/media/` in the repo.
            `${browseUrl}/raw/${tag}/docs/media/forgekit-core-overview.png`,
            `${browseUrl}/raw/${tag}/docs/media/forgekit-core-editor.png`,
        ],
        notes: [
            'Submit at https://godotengine.org/asset-library/asset/submit.',
            'Paste the fields above into the form. AssetLib auto-fills the commit hash from the Download URL.',
            'Attach the preview images manually through the "Add preview" button once screenshots are uploaded to the repository.',
            'Subsequent releases use "Update this asset" on the existing asset page rather than a fresh submission.',
        ],
    };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderText(payload) {
    const lines = [];
    lines.push('Godot AssetLib submission payload');
    lines.push('==================================');
    lines.push(`Title:              ${payload.title}`);
    lines.push(`Version:            ${payload.version}`);
    lines.push(`Godot version:      ${payload.godot_version}`);
    lines.push(`Author:             ${payload.author}`);
    lines.push(`License:            ${payload.license}`);
    lines.push(`Category:           ${payload.category}`);
    lines.push(`Support level:      ${payload.support_level}`);
    lines.push('');
    lines.push('Description:');
    lines.push(`  ${payload.description}`);
    lines.push('');
    lines.push(`Repository URL:     ${payload.browse_url}`);
    lines.push(`Issue tracker URL:  ${payload.issues_url}`);
    lines.push(`Download provider:  ${payload.download_provider}`);
    lines.push(`Download commit:    ${payload.download_commit}`);
    lines.push(`Download URL:       ${payload.download_url}`);
    lines.push('');
    lines.push('Preview image URLs (paste one per preview field):');
    for (const preview of payload.previews) {
        lines.push(`  - ${preview}`);
    }
    lines.push('');
    lines.push('Notes:');
    for (const note of payload.notes) {
        lines.push(`  - ${note}`);
    }
    return lines.join('\n');
}

function renderJson(payload) {
    return JSON.stringify(payload, null, 2);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help === true) {
        console.log(
            `Usage: prepare-assetlib-submission.js [--plugin-cfg <path>] [--version <string>]\n` +
            `                                     [--release-url <url>] [--owner <name>]\n` +
            `                                     [--repo <name>] [--tag <string>]\n` +
            `                                     [--format text|json]\n`,
        );
        return;
    }
    const { options } = parsed;
    const pluginCfg = await readPluginCfg(options.pluginCfg);
    const payload = assemblePayload(pluginCfg, options);
    if (options.format === 'json') {
        console.log(renderJson(payload));
        return;
    }
    console.log(renderText(payload));
}

main().catch((err) => {
    console.error('prepare-assetlib-submission: failed');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
