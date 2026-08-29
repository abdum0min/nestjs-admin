import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { PrismaClient } from './.generated/client/client.js'

const here = dirname(fileURLToPath(import.meta.url))

export const FIXTURE_SCHEMA_PATH = resolve(here, 'fixtures/schema.prisma')
const DATABASE_FILE = resolve(here, '.generated/test.db')

/**
 * Construct a client for the fixture database.
 *
 * Note this happens in the *test*, never in the adapter: Prisma 7 builds
 * clients from driver adapters, so only the application knows the provider and
 * connection details. The adapter receives what we build here, which is
 * exactly how a consumer will use it.
 */
export function createTestClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${DATABASE_FILE}` }),
  })
}

/** Empty every table. Posts first - they reference users. */
export async function resetDatabase(client: PrismaClient): Promise<void> {
  await client.post.deleteMany({})
  await client.user.deleteMany({})
  await client.product.deleteMany({})
  await client.counter.deleteMany({})
}
