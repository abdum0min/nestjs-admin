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

    expect(body.data.models.map((m: { name: string }) => m.name).sort()).toEqual(['Post', 'User'])
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

  it('surfaces a database constraint failure as a safe 500', async () => {
    await http().post('/admin/User').send({ email: 'dupe@example.com', name: 'One' }).expect(201)

    const { body } = await http()
      .post('/admin/User')
      .send({ email: 'dupe@example.com', name: 'Two' })
      .expect(500)

    expect(body.error.code).toBe('INTERNAL_ERROR')
    // The adapter's message names Prisma and a source path; neither may escape.
    expect(body.error.message).not.toMatch(/prisma/i)
    expect(body.error.message).not.toContain('adapter.ts')
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
