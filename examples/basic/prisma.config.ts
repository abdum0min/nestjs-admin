import { defineConfig, env } from 'prisma/config'

/**
 * Prisma 7 configuration.
 *
 * The connection URL is no longer allowed in `schema.prisma`; migration and
 * introspection commands read it from here instead, and the runtime client is
 * constructed with a driver adapter (see src/app.module.ts).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
