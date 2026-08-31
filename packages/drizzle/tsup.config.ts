import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // The consumer's Drizzle instance is resolved from their own project, and
  // Core stays external for the reason `packages/prisma` records: the final
  // build resolves it once, and inlining it here would produce a second copy.
  external: ['drizzle-orm', '@nest-admin/core'],
})
