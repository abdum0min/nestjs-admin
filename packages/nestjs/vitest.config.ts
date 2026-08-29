import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to source rather than their built `dist`.
      // Without this, tests would silently run against whatever was last
      // built. Published resolution is covered by `pnpm build` + `typecheck`.
      '@nest-admin/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@nest-admin/prisma': fileURLToPath(new URL('../prisma/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // The end-to-end suite writes to a single SQLite file.
    fileParallelism: false,
    passWithNoTests: true,
  },
})
