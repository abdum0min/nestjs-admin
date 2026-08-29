import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'schema.prisma',
  datasource: { url: 'file:../.generated/e2e.db' },
})
