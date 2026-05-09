#!/usr/bin/env node
/**
 * Node-only driver for `project.check_imports`.
 *
 * Imports the compiled
 * `mcp-server/dist/src/tools/project/check_imports.js` directly (no
 * JSON-RPC round-trip, no spawning Godot) and runs it against the
 * repository root. Prints every offending file and its forbidden
 * imports to stdout, then exits with code `1` when violations are
 * present so the script is CI-friendly.
 *
 * Requires a prior `npm --prefix mcp-server run build` so the
 * compiled JavaScript is on disk.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

const { checkImports } = await import(
    resolve(projectRoot, 'mcp-server', 'dist', 'src', 'tools', 'project', 'check_imports.js')
);

const result = await checkImports({ projectRoot });
console.log(`violations: ${result.violations.length}`);
for (const v of result.violations) {
    console.log(`  - ${v.file}  ${v.reason}`);
    for (const imp of v.imports) {
        console.log(`      > ${imp}`);
    }
}
if (result.violations.length > 0) {
    process.exit(1);
}
