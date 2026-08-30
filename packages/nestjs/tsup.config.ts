import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    prisma: 'src/prisma.ts',
  },
  format: ['esm', 'cjs'],
  // The declaration build must be told to follow the workspace packages, not
  // just leave their imports in place. This is only half the fix - see the
  // note on `noExternal` below for the other half; neither works alone.
  dts: { resolve: [/^@nest-admin\//] },
  // `import.meta.url` is used to locate the bundled UI relative to this file.
  // Shims rewrite it for the CJS output, so both formats resolve their own
  // directory rather than the consumer's cwd.
  shims: true,
  sourcemap: true,
  clean: true,
  // Everything the consuming application already owns stays external, plus
  // `@prisma/get-dmmf`. That one is not about ownership: it loads a .wasm file
  // with a require() resolved relative to its own package. Bundling it produces
  // a build that imports fine and then dies at runtime looking for
  // prisma_schema_build_bg.wasm next to our bundle - which only shows up when
  // an actual consumer starts. It is declared as a real dependency instead.
  external: [
    '@nestjs/common',
    '@nestjs/core',
    '@prisma/client',
    '@prisma/get-dmmf',
    'reflect-metadata',
    'rxjs',
  ],
  // Internal workspace packages are bundled in so that a single tarball is
  // published. See docs/publishing.md.
  //
  // `noExternal` alone is not enough: tsup auto-externalises everything listed
  // in `dependencies`, and that applies to the declaration build even when the
  // JS bundle inlines the package. So `@nest-admin/core` and
  // `@nest-admin/prisma` are declared as devDependencies - they are build
  // inputs, not runtime dependencies - which is both what makes the emitted
  // .d.ts self-contained and what keeps the published `dependencies` free of
  // packages that are never published.
  noExternal: ['@nest-admin/core', '@nest-admin/prisma'],
})
