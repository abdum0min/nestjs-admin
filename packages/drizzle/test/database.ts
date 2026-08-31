/**
 * A real SQLite database, in memory, per suite.
 *
 * The same standard the Prisma adapter is held to: no mock of the driver, no
 * fake query builder. If a `LIKE` pattern is wrong or a foreign key is not
 * enforced, these tests find out the way production would.
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { DrizzleAdapter } from '../src/index.js'
import * as schema from './schema.js'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)

export function seeded(): {
  adapter: DrizzleAdapter
  db: ReturnType<typeof drizzle>
  close(): void
} {
  const sqlite = new Database(':memory:')
  // Off by default in SQLite, and the adapter's foreign-key error mapping is
  // only reachable when the database actually enforces them.
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(schema.DDL)

  const db = drizzle(sqlite, { schema })

  db.insert(schema.users)
    .values([
      {
        id: 'u1',
        email: 'ada@example.com',
        name: 'Ada',
        age: 36,
        role: 'ADMIN',
        createdAt: ago(1),
      },
      {
        id: 'u2',
        email: 'bob@example.com',
        name: 'Bob',
        age: 41,
        active: false,
        createdAt: ago(2),
      },
      {
        id: 'u3',
        email: 'cy@example.com',
        name: 'Cy 100%',
        bio: 'Loves _underscores_',
        createdAt: ago(9),
      },
    ])
    .run()

  db.insert(schema.posts)
    .values([
      { id: 'p1', title: 'First', body: 'Hello', published: true, views: 10, authorId: 'u1' },
      { id: 'p2', title: 'Second', body: 'World', views: 5, authorId: 'u1' },
      { id: 'p3', title: 'Orphan', views: 1 },
    ])
    .run()

  db.insert(schema.comments)
    .values([
      { id: 'c1', body: 'Nice', postId: 'p1' },
      { id: 'c2', body: 'Agreed', postId: 'p1' },
    ])
    .run()

  db.insert(schema.tags)
    .values([{ id: 't1', label: 'news' }])
    .run()
  db.insert(schema.postTags)
    .values([{ postId: 'p1', tagId: 't1' }])
    .run()

  return {
    adapter: new DrizzleAdapter({ db, schema }),
    db,
    close: () => sqlite.close(),
  }
}

/** The model metadata, by name, for the tests that read it. */
export function byName(models: readonly { name: string }[]): Record<string, never> {
  return Object.fromEntries(models.map((model) => [model.name, model])) as Record<string, never>
}
