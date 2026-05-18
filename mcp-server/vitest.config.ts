/**
 * Vitest configuration for `@forgekitstudio/core-mcp`.
 *
 * Pin the discovery pattern to `test/**\/*.test.ts` so `npm test` only
 * runs files inside the package's own `test/` tree. This excludes any
 * stray `*.test.ts` files that might land under `dist/`,
 * `node_modules/`, or `scripts/git-hooks/` (the git-hook property tests
 * have their own runner).
 *
 * `pretest: "npm run build"` in `package.json` continues to compile the
 * TypeScript before the tests run, so the spawn-binary tests
 * (`index_cli.test.ts`, `profile_flag_validation.test.ts`,
 * `cli_install_hooks.test.ts`) always see a fresh `dist/`.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        exclude: [
            'node_modules/**',
            'dist/**',
            'scripts/**',
        ],
    },
});
