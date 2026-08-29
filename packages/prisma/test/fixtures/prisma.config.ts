import { defineConfig } from 'prisma/config'

/**
 * Config for the integration-test fixture schema only. The database is a
 * throwaway SQLite file under `.generated/`, so tests need no external
 * service and no developer-specific configuration.
 */
export default defineConfig({
  schema: 'schema.prisma',
  datasource: { url: 'file:../.generated/test.db' },
})
