import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // The consumer's generated Prisma Client is always resolved from their own
  // project. Bundling it would produce a second, schema-less copy.
  external: ['@prisma/client'],
  // Core is an internal workspace package and is bundled in.
  noExternal: ['@nest-admin/core'],
})
