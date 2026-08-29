import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace package to its source rather than its built
      // `dist`. Without this, tests silently run against whatever was last
      // built, so a change to Core would appear to fail here until someone
      // remembered to rebuild. The published resolution is covered by
      // `pnpm build` and `pnpm typecheck` instead.
      '@nest-admin/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // The fixture database is a single SQLite file; parallel suites writing to
    // it would race. These tests are fast enough not to need the parallelism.
    fileParallelism: false,
    passWithNoTests: true,
  },
})
