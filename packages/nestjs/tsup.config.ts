import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    prisma: 'src/prisma.ts',
  },
  format: ['esm', 'cjs'],
  // KNOWN PUBLISHING ISSUE: the JS bundle correctly inlines the workspace
  // packages (verified - zero `@nest-admin/*` requires in dist/index.js), but
  // the emitted .d.ts still imports its types from `@nest-admin/core`, which is
  // `private: true` and never published, so a consumer would install types that
  // cannot resolve. `dts: { resolve: true }` fails the build on decorators and
  // an allowlist has no effect. Must be solved before the first publish - see
  // docs/publishing.md and reports/004-http-api.md.
  dts: true,
  sourcemap: true,
  clean: true,
  // Everything the consuming application already owns stays external.
  external: ['@nestjs/common', '@nestjs/core', '@prisma/client', 'reflect-metadata', 'rxjs'],
  // Internal workspace packages are bundled in so that a single tarball is
  // published. See docs/publishing.md.
  noExternal: ['@nest-admin/core', '@nest-admin/prisma'],
})
