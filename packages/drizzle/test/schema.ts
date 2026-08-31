/**
 * A schema for the adapter to read.
 *
 * Shaped to match the Prisma adapter's fixture where it can, so the two suites
 * ask the same questions of the same data, and deliberately different in three
 * places where the ORMs are:
 *
 *  - `posts.authorId` has **no** `relations()` declaration, so the foreign-key
 *    fallback is exercised;
 *  - `comments` **does** have one, so the declared path is exercised beside it;
 *  - `postTags` is a join table with its own key, because Drizzle has no
 *    many-to-many and this is what one actually looks like.
 */
import { relations, sql } from 'drizzle-orm'
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  bio: text('bio'),
  age: integer('age'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  role: text('role', { enum: ['USER', 'ADMIN'] })
    .notNull()
    .default('USER'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body'),
  published: integer('published', { mode: 'boolean' }).notNull().default(false),
  views: integer('views').notNull().default(0),
  // No `relations()` for this one. The adapter must still find both ends.
  authorId: text('author_id').references(() => users.id),
})

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
  postId: text('post_id')
    .notNull()
    .references(() => posts.id),
})

/** Declared, so the developer's own names win over anything derived. */
export const postsRelations = relations(posts, ({ many }) => ({
  discussion: many(comments),
}))

export const commentsRelations = relations(comments, ({ one }) => ({
  onPost: one(posts, { fields: [comments.postId], references: [posts.id] }),
}))

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  label: text('label').notNull().unique(),
})

/** A composite key, which the metadata mapper has to read from the dialect. */
export const postTags = sqliteTable(
  'post_tags',
  {
    postId: text('post_id')
      .notNull()
      .references(() => posts.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (table) => [primaryKey({ columns: [table.postId, table.tagId] })],
)

export const DDL = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    bio TEXT,
    age INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    role TEXT NOT NULL DEFAULT 'USER',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT,
    published INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    author_id TEXT REFERENCES users(id)
  );
  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    post_id TEXT NOT NULL REFERENCES posts(id)
  );
  CREATE TABLE tags (id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE);
  CREATE TABLE post_tags (
    post_id TEXT NOT NULL REFERENCES posts(id),
    tag_id TEXT NOT NULL REFERENCES tags(id),
    PRIMARY KEY (post_id, tag_id)
  );
`

/**
 * Integer keys, and relations between them.
 *
 * The Prisma adapter shipped a defect where an id from a URL - always a string
 * - reached the query builder without being converted to the key's declared
 * type, on every relation route. Drizzle's adapter resolves a related list from
 * the parent record's own value rather than from the id, so it should not be
 * reachable here. "Should not" is not evidence, so these tables exist to ask.
 */
export const meters = sqliteTable('meters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
})

export const samples = sqliteTable('samples', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  value: integer('value').notNull(),
  meterId: integer('meter_id').references(() => meters.id),
})

export const NUMERIC_DDL = `
  CREATE TABLE meters (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL);
  CREATE TABLE samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    value INTEGER NOT NULL,
    meter_id INTEGER REFERENCES meters(id)
  );
`
