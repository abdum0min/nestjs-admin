import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    prisma: 'src/prisma.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Everything the consuming application already owns stays external.
  external: ['@nestjs/common', '@nestjs/core', '@prisma/client', 'reflect-metadata', 'rxjs'],
  // Internal workspace packages are bundled in so that a single tarball is
  // published. See docs/publishing.md.
  noExternal: ['@nest-admin/core', '@nest-admin/prisma'],
})
