/**
 * End-to-end: HTTP request -> AdminModule -> PrismaAdapter -> SQLite.
 *
 * The rest of the HTTP suite runs against `InMemoryAdapter` to prove the layer
 * is ORM-independent. This one proves the whole stack is actually wired
 * together: real Nest DI, real routing, the real Prisma adapter, a real
 * database. Nothing is mocked.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { UnauthorizedError } from '@nest-admin/core'
import { PrismaAdapter } from '@nest-admin/prisma'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createAdminApp } from './app.js'
import { PrismaClient } from './.generated/client/client.js'

const here = dirname(fileURLToPath(import.meta.url))
const SCHEMA = resolve(here, 'fixtures/schema.prisma')
const DATABASE = resolve(here, '.generated/e2e.db')

let app: INestApplication
let client: PrismaClient

beforeAll(async () => {
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DATABASE}` }) })
  // The application constructs the client and the adapter; the framework never
  // does. Under Prisma 7 only the application knows the driver adapter.
  app = await createAdminApp(new PrismaAdapter({ client, schemaPath: SCHEMA }))
})

afterAll(async () => {
  await app.close()
  await client.$disconnect()
})

beforeEach(async () => {
  await client.post.deleteMany({})
  await client.user.deleteMany({})
})

const http = () => request(app.getHttpServer())

async function seed(): Promise<void> {
  await http()
    .post('/admin/User')
    .send({ email: 'ada@example.com', name: 'Ada', age: 36 })
    .expect(201)
  await http()
    .post('/admin/User')
    .send({ email: 'bob@example.com', name: 'Bob', age: 25 })
    .expect(201)
}

describe('metadata over HTTP from a real schema', () => {
  it('describes the schema without naming the ORM', async () => {
    const { body, text } = await http().get('/admin/meta').expect(200)

    expect(body.data.models.map((m: { name: string }) => m.name).sort()).toEqual([
      'Post',
      'Tag',
      'User',
    ])
    expect(text.toLowerCase()).not.toContain('prisma')
    expect(text.toLowerCase()).not.toContain('dmmf')
  })

  it('carries the generated/default distinction end to end', async () => {
    const { body } = await http().get('/admin/meta').expect(200)
    const user = body.data.models.find((m: { name: string }) => m.name === 'User')
    const byName = (name: string) => user.fields.find((f: { name: string }) => f.name === name)

    expect(byName('id')).toMatchObject({ isId: true, isGenerated: true })
    expect(byName('createdAt')).toMatchObject({ isGenerated: true })
    expect(byName('active')).toMatchObject({ isGenerated: false, defaultValue: true })
    expect(byName('role')).toMatchObject({ kind: 'enum', enumValues: ['USER', 'ADMIN'] })
    expect(byName('posts')).toMatchObject({
      relation: { targetModel: 'Post', cardinality: 'many' },
    })
  })
})

describe('CRUD against a real database', () => {
  it('round-trips a record through every verb', async () => {
    const created = await http()
      .post('/admin/User')
      .send({ email: 'round@example.com', name: 'Round' })
      .expect(201)

    const id = created.body.data.id as string
    expect(typeof id).toBe('string')
    // Defaults were applied by the database, not by us.
    expect(created.body.data).toMatchObject({ active: true, role: 'USER' })

    await http().get(`/admin/User/${id}`).expect(200)

    const updated = await http().patch(`/admin/User/${id}`).send({ name: 'Round II' }).expect(200)
    expect(updated.body.data.name).toBe('Round II')

    await http().delete(`/admin/User/${id}`).expect(200)
    await http().get(`/admin/User/${id}`).expect(404)
  })

  it('answers a duplicate value with a conflict naming the field', async () => {
    await http().post('/admin/User').send({ email: 'dupe@example.com', name: 'One' }).expect(201)

    const { body } = await http()
      .post('/admin/User')
      .send({ email: 'dupe@example.com', name: 'Two' })
      .expect(409)

    expect(body.error.code).toBe('CONSTRAINT_VIOLATION')
    expect(body.error.message).toBe('Another User already has this email.')
    expect(body.error.details).toEqual({ constraint: 'unique', fields: ['email'] })
    // The adapter's message names Prisma and a source path; neither may escape.
    expect(JSON.stringify(body)).not.toMatch(/prisma/i)
    expect(JSON.stringify(body)).not.toContain('adapter.ts')
  })

  it('answers a missing required value with a 400 naming the field', async () => {
    const { body } = await http().post('/admin/User').send({ name: 'Nameless' }).expect(400)

    expect(body.error.code).toBe('CONSTRAINT_VIOLATION')
    expect(body.error.message).toBe('email is required.')
    expect(body.error.details).toEqual({ constraint: 'required', fields: ['email'] })
    // Prisma renders the submitted data and an absolute path into this one.
    expect(JSON.stringify(body)).not.toMatch(/invocation|.ts/)
  })

  it('answers a reference to a missing record with a conflict', async () => {
    const { body } = await http()
      .post('/admin/Post')
      .send({ title: 'Orphan', authorId: 'nobody' })
      .expect(409)

    expect(body.error.code).toBe('CONSTRAINT_VIOLATION')
    expect(body.error.details.constraint).toBe('foreign-key')
  })
})

describe('querying a real database over HTTP', () => {
  beforeEach(seed)

  it('paginates', async () => {
    const { body } = await http().get('/admin/User?page=1&perPage=1').expect(200)

    expect(body.data).toHaveLength(1)
    expect(body.meta).toEqual({ total: 2, page: 1, perPage: 1 })
  })

  it('sorts', async () => {
    const { body } = await http().get('/admin/User?sort=age:desc').expect(200)
    expect(body.data.map((r: { name: string }) => r.name)).toEqual(['Ada', 'Bob'])
  })

  it('filters with a coerced numeric value', async () => {
    const { body } = await http().get('/admin/User?filter=age:gte:30').expect(200)
    expect(body.data.map((r: { name: string }) => r.name)).toEqual(['Ada'])
  })

  it('filters on an enum', async () => {
    const { body } = await http().get('/admin/User?filter=role:in:USER').expect(200)
    expect(body.meta.total).toBe(2)
  })

  it('searches', async () => {
    const { body } = await http().get('/admin/User?search=bob').expect(200)
    expect(body.data.map((r: { name: string }) => r.name)).toEqual(['Bob'])
  })

  it('rejects an unknown field with 400, not a database error', async () => {
    const { body } = await http().get('/admin/User?sort=nope:asc').expect(400)
    expect(body.error.code).toBe('FIELD_NOT_FOUND')
  })
})

describe('security against the real adapter', () => {
  it('cannot address arbitrary client properties through the model name', async () => {
    // A Prisma client instance has plenty of callable internals; the metadata
    // allowlist means none of them are reachable by naming them.
    for (const name of ['__proto__', 'constructor', '$connect', '$queryRaw', '_engine']) {
      const { body } = await http().get(`/admin/${name}`).expect(404)
      expect(body.error.code).toBe('MODEL_NOT_FOUND')
    }
  })

  it('rejects writing a relation field', async () => {
    const { body } = await http()
      .post('/admin/User')
      .send({ email: 'rel@example.com', name: 'Rel', posts: [] })
      .expect(400)

    expect(body.error.code).toBe('FIELD_NOT_FOUND')
  })
})

describe('the auth boundary on the real stack', () => {
  it('protects every route in front of a real database', async () => {
    // The in-memory suite proves the guard's semantics; this proves it is
    // actually attached when the real adapter is wired in.
    const locked = await createAdminApp(new PrismaAdapter({ client, schemaPath: SCHEMA }), {
      authorize() {
        throw new UnauthorizedError()
      },
    })

    for (const path of ['/admin/meta', '/admin/User', '/admin/User/anything']) {
      const { body } = await request(locked.getHttpServer()).get(path).expect(401)
      expect(body.error.code).toBe('UNAUTHORIZED')
    }

    await request(locked.getHttpServer())
      .post('/admin/User')
      .send({ email: 'blocked@example.com', name: 'Blocked' })
      .expect(401)

    // Nothing was written despite a well-formed payload.
    expect(await client.user.count({ where: { email: 'blocked@example.com' } })).toBe(0)

    await locked.close()
  })
})

describe('resource authorization on the real stack', () => {
  it('filters metadata and blocks CRUD against a real database', async () => {
    // The in-memory suite proves the semantics; this proves the policy is
    // actually consulted when the real Prisma adapter is wired in.
    const restricted = await createAdminApp(
      new PrismaAdapter({ client, schemaPath: SCHEMA }),
      undefined,
      { authorize: ({ model }) => model !== 'Post' },
    )
    const http = () => request(restricted.getHttpServer())

    const { body, text } = await http().get('/admin/meta').expect(200)
    expect(body.data.models.map((m: { name: string }) => m.name)).toEqual(['User', 'Tag'])
    // Neither the hidden model nor any relation that pointed at it - including
    // Tag.posts, on a model that is still visible.
    expect(text).not.toContain('Post')
    expect(text).not.toContain('posts')

    await http().get('/admin/Post').expect(403)
    await http().get('/admin/User').expect(200)

    await restricted.close()
  })

  it('refuses a write to a denied model without touching the database', async () => {
    const before = await client.user.count()

    const readOnly = await createAdminApp(
      new PrismaAdapter({ client, schemaPath: SCHEMA }),
      undefined,
      { authorize: ({ operation }) => operation !== 'create' },
    )

    const { body } = await request(readOnly.getHttpServer())
      .post('/admin/User')
      .send({ email: 'denied@example.com', name: 'Denied' })
      .expect(403)

    expect(body.error.code).toBe('FORBIDDEN')
    expect(await client.user.count()).toBe(before)

    await readOnly.close()
  })
})

describe('the wire format the admin UI generates', () => {
  /**
   * The UI builds query strings itself (packages/admin-ui/src/api/query.ts) and is
   * tested against mocked responses. These are the exact strings that builder
   * produces, sent to the real server, so a drift between the two surfaces
   * here rather than in a browser.
   */
  const UI_QUERIES = [
    '?page=1&perPage=25',
    '?page=1&perPage=25&search=ada',
    '?page=1&perPage=25&sort=email%3Aasc',
    '?sort=email%3Aasc&sort=createdAt%3Adesc',
    '?filter=age%3Agte%3A18',
    '?filter=role%3Ain%3AADMIN%2CUSER',
    '?page=1&perPage=25&search=ada&sort=email%3Aasc&filter=age%3Agte%3A18',
  ]

  for (const query of UI_QUERIES) {
    it(`accepts ${decodeURIComponent(query)}`, async () => {
      const { body } = await http().get(`/admin/User${query}`).expect(200)

      expect(body.success).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
      // The pager reads exactly these three keys.
      expect(Object.keys(body.meta).sort()).toEqual(['page', 'perPage', 'total'])
    })
  }

  it('rejects bracket syntax instead of silently ignoring it', async () => {
    // Phase 6 recorded this returning 200 with the filter dropped, so a caller
    // believed it had filtered and received every record. Now a 400 that names
    // the syntax the server does accept.
    const { body } = await http().get('/admin/User?filter[age][gte]=18').expect(400)

    expect(body.error.code).toBe('INVALID_QUERY')
    expect(body.error.message).toContain('filter[age][gte]')
    expect(body.error.message).toMatch(/colon syntax/i)
  })

  it('rejects an unknown parameter rather than ignoring it', async () => {
    const { body } = await http().get('/admin/User?sortBy=email').expect(400)

    expect(body.error.code).toBe('INVALID_QUERY')
    expect(body.error.message).toMatch(/sortBy/)
  })

  it('never drops a filter that it accepted', async () => {
    // The guarantee behind both rejections: a 200 means every rule was applied.
    await seed()
    const all = await http().get('/admin/User').expect(200)
    const filtered = await http()
      .get('/admin/User?filter=email:contains:definitely-no-such-address')
      .expect(200)

    expect(all.body.meta.total).toBeGreaterThan(0)
    expect(filtered.body.meta.total).toBe(0)
  })

  it('describes metadata with exactly the keys the UI reads', async () => {
    const { body } = await http().get('/admin/meta').expect(200)
    const user = body.data.models.find((m: { name: string }) => m.name === 'User')

    expect(Object.keys(user).sort()).toEqual([
      'actions',
      'can',
      'displayField',
      'fields',
      'name',
      'primaryKey',
    ])

    const allowed = new Set([
      'name',
      'kind',
      'isId',
      'isRequired',
      'isUnique',
      'isList',
      'isGenerated',
      'readOnly',
      'label',
      'widget',
      'defaultValue',
      'enumValues',
      'relation',
    ])
    for (const field of user.fields) {
      for (const key of Object.keys(field)) expect(allowed).toContain(key)
    }
  })
})
