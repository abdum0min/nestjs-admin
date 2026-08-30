import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // The consumer's generated Prisma Client is always resolved from their own
  // project. Bundling it would produce a second, schema-less copy.
  // Core stays external here, even though it is an internal workspace package.
  // Inlining it would put a second physical copy of Core into this dist, and the
  // published package bundles both this and Core - so esbuild would see two
  // unrelated sources and could not share them. Leaving the import in place lets
  // the final build resolve Core once. See docs/publishing.md.
  external: ['@prisma/client', '@nest-admin/core'],
})
