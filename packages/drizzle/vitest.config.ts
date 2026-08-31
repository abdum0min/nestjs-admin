import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The same reason `packages/prisma` does it: run against Core's source,
      // not against whatever `dist` was last built.
      '@nest-admin/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    passWithNoTests: true,
  },
})
