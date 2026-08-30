import { defineConfig } from 'prisma/config'

/**
 * Prisma 7 configuration.
 *
 * The connection URL is no longer allowed in `schema.prisma`; migration and
 * introspection commands read it from here instead, and the runtime client is
 * constructed with a driver adapter (see src/app.module.ts).
 *
 * The default matches the one in `src/app.module.ts` on purpose. Prisma 7 no
 * longer loads `.env` by itself when a config file is present, and `.env` is
 * git-ignored - so `env('DATABASE_URL')` made `prisma generate` fail on a fresh
 * clone, before the developer had done anything wrong. An environment variable
 * still wins where one is set.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'file:./dev.db',
  },
})
