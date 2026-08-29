/**
 * The admin HTTP boundary, exercised through a real Nest application over real
 * HTTP.
 *
 * The adapter behind it is `InMemoryAdapter` - a second implementation of
 * Core's `OrmAdapter`, not a Prisma mock. That is the point: if these pass,
 * the HTTP layer provably works against any conforming adapter, which is the
 * property that makes a future TypeORM or Drizzle adapter a backend-only
 * change. End-to-end coverage with the real Prisma adapter lives in
 * `e2e.test.ts`.
 */
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import { createAdminApp } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication
let adapter: InMemoryAdapter

const USERS = [
  {
    id: 'u1',
    email: 'ada@example.com',
    name: 'Ada',
    age: 36,
    active: true,
    role: 'ADMIN',
    createdAt: '2024-01-01',
  },
  {
    id: 'u2',
    email: 'bob@example.com',
    name: 'Bob',
    age: 25,
    active: true,
    role: 'USER',
    createdAt: '2024-02-01',
  },
  {
    id: 'u3',
    email: 'cyd@example.com',
    name: 'Cyd',
    age: 41,
    active: false,
    role: 'USER',
    createdAt: '2024-03-01',
  },
]

beforeEach(async () => {
  adapter = new InMemoryAdapter({ User: USERS, Post: [] })
  app = await createAdminApp(adapter)
})

afterEach(async () => {
  await app.close()
})

const http = () => request(app.getHttpServer())

describe('module wiring', () => {
  it('registers the supplied adapter and serves routes from it', async () => {
    const response = await http().get('/admin/meta').expect(200)
    expect(response.body.data.models.map((m: { name: string }) => m.name)).toEqual(['User', 'Post'])
  })

  it('refuses to construct without an adapter', async () => {
    const { AdminModule } = await import('../src/module.js')
    expect(() =>
      AdminModule.forRoot({ adapter: undefined as never, auth: unsafeAllowAllRequests() }),
    ).toThrow(/requires an `adapter`/)
  })
})

describe('GET /admin/meta', () => {
  it('returns models with their primary keys', async () => {
    const { body } = await http().get('/admin/meta').expect(200)

    expect(body.success).toBe(true)
    const user = body.data.models.find((m: { name: string }) => m.name === 'User')
    expect(user.primaryKey).toEqual(['id'])
  })

  it('describes field types, requiredness and uniqueness', async () => {
    const { body } = await http().get('/admin/meta').expect(200)
    const fields = body.data.models[0].fields as Array<Record<string, unknown>>
    const byName = (name: string) => fields.find((f) => f['name'] === name)

    expect(byName('email')).toMatchObject({ kind: 'string', isRequired: true, isUnique: true })
    expect(byName('name')).toMatchObject({ isRequired: false })
    expect(byName('age')).toMatchObject({ kind: 'number' })
  })

  it('marks generated fields and exposes literal defaults', async () => {
    const { body } = await http().get('/admin/meta').expect(200)
    const fields = body.data.models[0].fields as Array<Record<string, unknown>>
    const byName = (name: string) => fields.find((f) => f['name'] === name)

    expect(byName('id')).toMatchObject({ isId: true, isGenerated: true })
    expect(byName('createdAt')).toMatchObject({ isGenerated: true })
    // A literal default is an editable field arriving pre-filled, not a
    // generated one - the distinction the frontend renders forms from.
    expect(byName('active')).toMatchObject({ isGenerated: false, defaultValue: true })
    expect(byName('id')).not.toHaveProperty('defaultValue')
  })

  it('represents enums with their values', async () => {
    const { body } = await http().get('/admin/meta').expect(200)
    const role = body.data.models[0].fields.find((f: { name: string }) => f.name === 'role')
    expect(role).toMatchObject({ kind: 'enum', enumValues: ['USER', 'ADMIN'] })
  })

  it('represents relations and their cardinality', async () => {
    const { body } = await http().get('/admin/meta').expect(200)
    const models = body.data.models as Array<{
      name: string
      fields: Array<Record<string, unknown>>
    }>

    const posts = models[0]!.fields.find((f) => f['name'] === 'posts')
    expect(posts).toMatchObject({
      kind: 'relation',
      isList: true,
      relation: { targetModel: 'Post', cardinality: 'many' },
    })

    const author = models[1]!.fields.find((f) => f['name'] === 'author')
    expect(author).toMatchObject({ relation: { targetModel: 'User', cardinality: 'one' } })
  })

  it('leaks no ORM vocabulary', async () => {
    const { text } = await http().get('/admin/meta').expect(200)
    // The whole point of the DTO: this response must be identical in shape
    // whichever adapter produced it.
    expect(text.toLowerCase()).not.toContain('prisma')
    expect(text.toLowerCase()).not.toContain('dmmf')
    for (const leak of [
      'relationName',
      'hasDefaultValue',
      'isUpdatedAt',
      'dbName',
      'documentation',
    ]) {
      expect(text).not.toContain(leak)
    }
  })

  it('exposes only the documented field keys', async () => {
    const { body } = await http().get('/admin/meta').expect(200)
    const allowed = new Set([
      'name',
      'kind',
      'isId',
      'isRequired',
      'isUnique',
      'isList',
      'isGenerated',
      'defaultValue',
      'enumValues',
      'relation',
    ])
    for (const model of body.data.models) {
      expect(Object.keys(model).sort()).toEqual(['fields', 'name', 'primaryKey'])
      for (const field of model.fields) {
        for (const key of Object.keys(field)) expect(allowed).toContain(key)
      }
    }
  })
})

describe('CRUD', () => {
  it('lists records with pagination metadata', async () => {
    const { body } = await http().get('/admin/User').expect(200)

    expect(body).toMatchObject({ success: true, meta: { total: 3, page: 1, perPage: 25 } })
    expect(body.data).toHaveLength(3)
  })

  it('fetches one record', async () => {
    const { body } = await http().get('/admin/User/u1').expect(200)
    expect(body).toMatchObject({ success: true, data: { id: 'u1', name: 'Ada' } })
  })

  it('creates a record', async () => {
    const { body } = await http()
      .post('/admin/User')
      .send({ email: 'new@example.com', name: 'New' })
      .expect(201)

    expect(body.success).toBe(true)
    expect(body.data).toMatchObject({ email: 'new@example.com' })
    expect((await http().get('/admin/User')).body.meta.total).toBe(4)
  })

  it('updates a record', async () => {
    const { body } = await http().patch('/admin/User/u1').send({ name: 'Ada L' }).expect(200)

    expect(body.data).toMatchObject({ id: 'u1', name: 'Ada L', email: 'ada@example.com' })
  })

  it('deletes a record', async () => {
    const { body } = await http().delete('/admin/User/u2').expect(200)

    expect(body).toEqual({ success: true, data: null })
    await http().get('/admin/User/u2').expect(404)
  })

  it('serves every model through the same controller', async () => {
    await http().get('/admin/User').expect(200)
    await http().get('/admin/Post').expect(200)
  })
})

describe('query parsing', () => {
  it('parses pagination', async () => {
    const { body } = await http().get('/admin/User?page=2&perPage=2').expect(200)

    expect(body.meta).toEqual({ total: 3, page: 2, perPage: 2 })
    expect(body.data).toHaveLength(1)
  })

  it('parses a single sort rule', async () => {
    await http().get('/admin/User?sort=age:asc').expect(200)
    expect(adapter.lastListQuery?.query.sort).toEqual([{ field: 'age', direction: 'asc' }])
  })

  it('parses multiple sort rules and preserves their order', async () => {
    await http().get('/admin/User?sort=role:asc&sort=age:desc').expect(200)

    expect(adapter.lastListQuery?.query.sort).toEqual([
      { field: 'role', direction: 'asc' },
      { field: 'age', direction: 'desc' },
    ])
  })

  it('coerces filter values using field metadata', async () => {
    await http().get('/admin/User?filter=age:gte:30').expect(200)

    // Reaches the adapter as a number, not the string "30" - without this a
    // numeric comparison would be done lexically or rejected outright.
    expect(adapter.lastListQuery?.query.filters).toEqual([
      { field: 'age', operator: 'gte', value: 30 },
    ])
  })

  it('coerces booleans', async () => {
    await http().get('/admin/User?filter=active:eq:false').expect(200)
    expect(adapter.lastListQuery?.query.filters?.[0]?.value).toBe(false)
  })

  it('coerces dates', async () => {
    await http().get('/admin/User?filter=createdAt:gte:2024-02-01').expect(200)
    expect(adapter.lastListQuery?.query.filters?.[0]?.value).toBeInstanceOf(Date)
  })

  it('parses "in" as a list', async () => {
    await http().get('/admin/User?filter=role:in:ADMIN,USER').expect(200)
    expect(adapter.lastListQuery?.query.filters).toEqual([
      { field: 'role', operator: 'in', value: ['ADMIN', 'USER'] },
    ])
  })

  it('parses multiple filters', async () => {
    await http().get('/admin/User?filter=age:gte:30&filter=role:eq:ADMIN').expect(200)
    expect(adapter.lastListQuery?.query.filters).toHaveLength(2)
  })

  it('applies filters to the result', async () => {
    const { body } = await http().get('/admin/User?filter=age:gte:30').expect(200)
    expect(body.data.map((row: { name: string }) => row.name).sort()).toEqual(['Ada', 'Cyd'])
  })

  it('parses search', async () => {
    const { body } = await http().get('/admin/User?search=bob').expect(200)
    expect(body.data).toHaveLength(1)
  })

  it('keeps colons inside a filter value', async () => {
    await http().get('/admin/User?filter=name:eq:12:30').expect(200)
    // Split into at most three parts, so a value may contain colons.
    expect(adapter.lastListQuery?.query.filters?.[0]?.value).toBe('12:30')
  })

  it('omits absent query parts rather than inventing defaults', async () => {
    await http().get('/admin/User').expect(200)
    const query = adapter.lastListQuery?.query ?? {}

    expect(query).not.toHaveProperty('sort')
    expect(query).not.toHaveProperty('filters')
    expect(query).not.toHaveProperty('search')
  })
})

describe('query validation', () => {
  const badRequest = (url: string, pattern: RegExp) =>
    it(`rejects ${url}`, async () => {
      const { body } = await http().get(url).expect(400)
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('INVALID_QUERY')
      expect(body.error.message).toMatch(pattern)
    })

  badRequest('/admin/User?page=abc', /page/i)
  badRequest('/admin/User?page=0', /page/i)
  badRequest('/admin/User?page=-1', /page/i)
  badRequest('/admin/User?perPage=hello', /perPage/i)
  badRequest('/admin/User?sort=name', /sort/i)
  badRequest('/admin/User?sort=name:sideways', /direction/i)
  badRequest('/admin/User?filter=age', /filter/i)
  badRequest('/admin/User?filter=age:nope:1', /operator/i)
  badRequest('/admin/User?filter=age:gte:abc', /number/i)
  badRequest('/admin/User?filter=active:eq:maybe', /boolean/i)
  badRequest('/admin/User?filter=createdAt:gte:not-a-date', /date/i)

  it('treats an empty sort as absent rather than failing', async () => {
    await http().get('/admin/User?sort=').expect(200)
    expect(adapter.lastListQuery?.query.sort).toBeUndefined()
  })

  it('rejects an unknown sort field with 400', async () => {
    const { body } = await http().get('/admin/User?sort=nope:asc').expect(400)
    expect(body.error.code).toBe('FIELD_NOT_FOUND')
  })

  it('rejects an unknown filter field with 400', async () => {
    const { body } = await http().get('/admin/User?filter=nope:eq:1').expect(400)
    expect(body.error.code).toBe('FIELD_NOT_FOUND')
  })
})

describe('error mapping', () => {
  it('maps an unknown model to 404', async () => {
    const { body } = await http().get('/admin/Nope').expect(404)

    expect(body.success).toBe(false)
    expect(body.error).toMatchObject({ code: 'MODEL_NOT_FOUND', details: { model: 'Nope' } })
  })

  it('maps a missing record to 404', async () => {
    const { body } = await http().get('/admin/User/missing').expect(404)
    expect(body.error).toMatchObject({ code: 'RECORD_NOT_FOUND', details: { model: 'User' } })
  })

  it('maps an unknown field to 400', async () => {
    const { body } = await http().post('/admin/User').send({ nope: 1 }).expect(400)
    expect(body.error).toMatchObject({ code: 'FIELD_NOT_FOUND', details: { field: 'nope' } })
  })

  it('returns 404 for update and delete against a missing record', async () => {
    await http().patch('/admin/User/missing').send({ name: 'x' }).expect(404)
    await http().delete('/admin/User/missing').expect(404)
  })

  it('is case-sensitive about model names and says which exist', async () => {
    const { body } = await http().get('/admin/user').expect(404)
    expect(body.error.message).toMatch(/Known models: User, Post/)
  })

  it('uses one envelope for every failure', async () => {
    for (const url of ['/admin/Nope', '/admin/User/missing', '/admin/User?page=0']) {
      const { body } = await http().get(url)
      expect(Object.keys(body).sort()).toEqual(['error', 'success'])
      expect(Object.keys(body.error)).toContain('code')
      expect(Object.keys(body.error)).toContain('message')
    }
  })
})

describe('security boundaries', () => {
  it('does not let a prototype-ish model name reach the adapter', async () => {
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      const { body } = await http().get(`/admin/${name}`).expect(404)
      expect(body.error.code).toBe('MODEL_NOT_FOUND')
    }
  })

  it('does not expose internal detail for an unexpected failure', async () => {
    const exploding = new InMemoryAdapter()
    exploding.list = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432 at /srv/app/secret/path.ts')
    }
    const isolated = await createAdminApp(exploding)

    const { body } = await request(isolated.getHttpServer()).get('/admin/User').expect(500)

    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.message).not.toContain('ECONNREFUSED')
    expect(body.error.message).not.toContain('/srv/app')
    expect(JSON.stringify(body)).not.toContain('stack')

    await isolated.close()
  })

  it('does not expose internal detail for an AdapterError', async () => {
    const { AdapterError } = await import('@nest-admin/core')
    const exploding = new InMemoryAdapter()
    exploding.list = async () => {
      throw new AdapterError('Prisma operation failed: file D:/app/src/adapter.ts line 42')
    }
    const isolated = await createAdminApp(exploding)

    const { body } = await request(isolated.getHttpServer()).get('/admin/User').expect(500)

    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.message).not.toContain('D:/app')
    expect(body.error.message).not.toContain('Prisma')

    await isolated.close()
  })
})
