/**
 * The whole admin, on a second ORM.
 *
 * `e2e.test.ts` proves the HTTP layer works over Prisma. This proves the same
 * routes work over Drizzle - a query builder with no generated client, no
 * DMMF and no normalised errors - with **no change anywhere above the
 * adapter**. The module, the controller, the query parser, the metadata DTO,
 * the exception filter, the dashboard and the served UI are the same code the
 * Prisma suite exercises.
 *
 * That is the whole reason the Drizzle adapter exists. Before 1.0 freezes
 * `OrmAdapter`, something other than Prisma had to implement it, and the
 * question worth answering is not "does the adapter work" - its own suite
 * answers that - but "does anything above it notice which ORM is underneath".
 *
 * If a Prisma assumption ever leaks upward into a controller, the query parser
 * or the dashboard, this file breaks.
 */
import { DrizzleAdapter } from '@nest-admin/drizzle'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import Database from 'better-sqlite3'
import { relations, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import { AdminModule } from '../src/module.js'
import { BUILT_UI_ROOT } from './app.js'

const authors = sqliteTable('authors', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

const articles = sqliteTable('articles', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: text('status', { enum: ['DRAFT', 'PUBLISHED'] })
    .notNull()
    .default('DRAFT'),
  authorId: text('author_id').references(() => authors.id),
  // Optional, a date, not generated: what soft delete needs of a column. Here
  // so the whole loop is proved against a real database rather than a double.
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
})

const authorsRelations = relations(authors, ({ many }) => ({ articles: many(articles) }))
const articlesRelations = relations(articles, ({ one }) => ({
  author: one(authors, { fields: [articles.authorId], references: [authors.id] }),
}))

const schema = { authors, articles, authorsRelations, articlesRelations }

const DAY = 86_400_000

let app: INestApplication
let sqlite: Database.Database

beforeAll(async () => {
  sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(`
    CREATE TABLE authors (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE articles (
      id TEXT PRIMARY KEY, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      author_id TEXT REFERENCES authors(id),
      deleted_at INTEGER
    );
  `)

  const db = drizzle(sqlite, { schema })
  const recent = Math.floor((Date.now() - DAY) / 1000)

  sqlite.exec(`
    INSERT INTO authors VALUES ('a1','ada@example.com','Ada',1,${recent});
    INSERT INTO authors VALUES ('a2','bob@example.com','Bob',0,${recent});
    INSERT INTO articles VALUES ('r1','Hello','PUBLISHED','a1',NULL);
    INSERT INTO articles VALUES ('r2','Draft','DRAFT','a1',NULL);
  `)

  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new DrizzleAdapter({ db, schema }),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        models: {
          authors: { label: 'Writers', displayField: 'name' },
          articles: { softDelete: 'deletedAt' },
        },
      }),
    ],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app?.close()
  sqlite?.close()
})

const get = (path: string) => request(app.getHttpServer()).get(path)

describe('metadata', () => {
  it('describes a Drizzle schema through the same document', async () => {
    const { body } = await get('/admin/meta').expect(200)

    const names = body.data.models.map((model: { name: string }) => model.name)
    expect(names).toEqual(['authors', 'articles'])

    // Overrides apply the same way - nothing about them knows the ORM.
    const writers = body.data.models[0]
    expect(writers.label).toBe('Writers')
    expect(writers.displayField).toBe('name')
  })

  it('reports kinds, enums and generated columns the interface can draw', async () => {
    const { body } = await get('/admin/meta').expect(200)
    const articlesModel = body.data.models[1]

    const status = articlesModel.fields.find((field: { name: string }) => field.name === 'status')
    expect(status).toMatchObject({ kind: 'enum', enumValues: ['DRAFT', 'PUBLISHED'] })

    const authorsModel = body.data.models[0]
    const createdAt = authorsModel.fields.find((f: { name: string }) => f.name === 'createdAt')
    // `sql`(unixepoch())`` - the form must not ask a person for it.
    expect(createdAt).toMatchObject({ kind: 'datetime', readOnly: true })
  })

  it('describes both ends of a relation', async () => {
    const { body } = await get('/admin/meta').expect(200)

    const author = body.data.models[1].fields.find((f: { name: string }) => f.name === 'author')
    expect(author.relation).toMatchObject({ targetModel: 'authors', cardinality: 'one' })

    const owned = body.data.models[0].fields.find((f: { name: string }) => f.name === 'articles')
    expect(owned.relation).toMatchObject({ targetModel: 'articles', cardinality: 'many' })
  })
})

describe('the list screen', () => {
  it('pages and reports the total', async () => {
    const { body } = await get('/admin/articles?page=1&perPage=1').expect(200)
    expect(body.data).toHaveLength(1)
    expect(body.meta).toMatchObject({ total: 2, page: 1, perPage: 1 })
  })

  it('filters through the same field:operator:value the URL carries', async () => {
    const { body } = await get('/admin/articles?filter=status:eq:PUBLISHED').expect(200)
    expect(body.data.map((row: { title: string }) => row.title)).toEqual(['Hello'])
  })

  it('coerces a boolean in the URL against the schema', async () => {
    // The query parser reads the kind from metadata this adapter produced. If
    // it got the kind wrong, `active:eq:false` compares a string to an integer
    // and quietly returns nothing.
    const { body } = await get('/admin/authors?filter=active:eq:false').expect(200)
    expect(body.data.map((row: { name: string }) => row.name)).toEqual(['Bob'])
  })

  it('sorts and searches', async () => {
    const sorted = await get('/admin/articles?sort=title:desc').expect(200)
    expect(sorted.body.data.map((row: { title: string }) => row.title)).toEqual(['Hello', 'Draft'])

    const found = await get('/admin/authors?search=ada').expect(200)
    expect(found.body.data).toHaveLength(1)
  })

  it('refuses an unknown field with the same 400 as Prisma does', async () => {
    const { body } = await get('/admin/authors?filter=nope:eq:1').expect(400)
    expect(body.error.code).toBe('FIELD_NOT_FOUND')
  })
})

describe('writing', () => {
  it('creates, reads back, updates and deletes', async () => {
    const created = await request(app.getHttpServer())
      .post('/admin/authors')
      .send({ id: 'a3', email: 'cy@example.com', name: 'Cy' })
      .expect(201)

    // The stored row, not the submitted body: `active` and `createdAt` were
    // filled in by the database.
    expect(created.body.data).toMatchObject({ id: 'a3', name: 'Cy', active: true })

    await get('/admin/authors/a3').expect(200)

    const updated = await request(app.getHttpServer())
      .patch('/admin/authors/a3')
      .send({ name: 'Cy B.' })
      .expect(200)
    expect(updated.body.data.name).toBe('Cy B.')

    await request(app.getHttpServer()).delete('/admin/authors/a3').expect(200)
    await get('/admin/authors/a3').expect(404)
  })

  it('turns a driver constraint into a message beside the field', async () => {
    // Prisma hands over P2002 and a `meta`. Drizzle hands over whatever
    // better-sqlite3 threw. The HTTP response has to be identical, because the
    // interface renders from it.
    const { body } = await request(app.getHttpServer())
      .post('/admin/authors')
      .send({ id: 'a4', email: 'ada@example.com' })
      .expect(409)

    expect(body.error.code).toBe('CONSTRAINT_VIOLATION')
    expect(body.error.message).toBe('Another authors already has this email.')
    expect(body.error.details).toEqual({ constraint: 'unique', fields: ['email'] })
    // The driver's own words - "SQLITE_CONSTRAINT_UNIQUE", a file path - must
    // not reach the browser, the same way Prisma's must not.
    expect(JSON.stringify(body)).not.toMatch(/sqlite|drizzle|.ts/i)
  })

  it('reports a missing record as 404, not as a silent no-op', async () => {
    await request(app.getHttpServer())
      .patch('/admin/authors/nobody')
      .send({ name: 'x' })
      .expect(404)
  })
})

describe('relations', () => {
  it('lists the far side of a to-many through the nested route', async () => {
    const { body } = await get('/admin/authors/a1/articles').expect(200)
    expect(body.data.map((row: { title: string }) => row.title).sort()).toEqual(['Draft', 'Hello'])
  })

  it('attaches and detaches through the same routes', async () => {
    await request(app.getHttpServer())
      .post('/admin/authors/a2/articles')
      .send({ id: 'r2' })
      .expect(201)
    expect((await get('/admin/authors/a2/articles')).body.data).toHaveLength(1)

    await request(app.getHttpServer()).delete('/admin/authors/a2/articles/r2').expect(200)
    expect((await get('/admin/authors/a2/articles')).body.data).toHaveLength(0)
  })
})

describe('the dashboard', () => {
  it('generates one from a Drizzle schema', async () => {
    const { body } = await get('/admin/dashboard').expect(200)

    expect(body.data.generated).toBe(true)

    const counts = body.data.widgets.filter((w: { kind: string }) => w.kind === 'count')
    // Labelled models keep their label here too.
    expect(counts.map((w: { title: string }) => w.title)).toContain('Writers')
    expect(counts[0].data.value).toBeGreaterThan(0)
  })

  it('finds the creation timestamp in a schema that never declared one', async () => {
    // `createdFieldFor` reads field names, and until now it had only ever read
    // names a Prisma schema produced. `authors.createdAt` is the Drizzle
    // property key, and the chart exists only if it was recognised.
    const { body } = await get('/admin/dashboard').expect(200)

    const chart = body.data.widgets.find((w: { kind: string }) => w.kind === 'chart')
    expect(chart).toBeDefined()
    expect(chart.model).toBe('authors')
    expect(chart.data.points.length).toBeGreaterThan(0)
    // Both authors were created a day ago, so a thirty-day chart contains them.
    expect(chart.data.total).toBeGreaterThanOrEqual(2)
  })

  it('offers no chart for a model with no creation timestamp', async () => {
    const { body } = await get('/admin/dashboard').expect(200)
    const charts = body.data.widgets.filter((w: { kind: string }) => w.kind === 'chart')
    expect(charts.every((w: { model: string }) => w.model !== 'articles')).toBe(true)
  })
})

describe('soft delete, on a real database', () => {
  /**
   * The reason this is here rather than only against the double.
   *
   * Every list on a soft-deleted model asks `deletedAt = null`, and SQL has no
   * equality with null: `col = NULL` is unknown, never true, so the Drizzle
   * adapter answered that filter with no rows at all while Prisma answered it
   * correctly. Two adapters disagreeing about the same filter is exactly what
   * this suite exists to catch.
   */
  it('hides a marked record and shows it again on request', async () => {
    await request(app.getHttpServer()).delete('/admin/articles/r2').expect(200)

    const live = await get('/admin/articles').expect(200)
    expect(live.body.data.map((row: { id: string }) => row.id)).toEqual(['r1'])

    const marked = await get('/admin/articles?deleted=deleted').expect(200)
    expect(marked.body.data.map((row: { id: string }) => row.id)).toEqual(['r2'])

    const all = await get('/admin/articles?deleted=all').expect(200)
    expect(all.body.data).toHaveLength(2)
  })

  it('restores it', async () => {
    await request(app.getHttpServer()).post('/admin/restore/articles/r2').expect(201)

    const live = await get('/admin/articles').expect(200)
    expect(live.body.data.map((row: { id: string }) => row.id)).toEqual(['r1', 'r2'])
  })

  it('still removes the row when asked to', async () => {
    await request(app.getHttpServer()).delete('/admin/articles/r2?permanent=true').expect(200)
    await get('/admin/articles/r2').expect(404)
  })
})
