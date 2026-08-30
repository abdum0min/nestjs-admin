/**
 * Resource-level authorization, exercised over real HTTP.
 *
 * The adapter behind these tests is `InMemoryAdapter` - a second, independent
 * implementation of Core's `OrmAdapter`, not a Prisma mock. Resource
 * authorization is an ORM-independent concern, so it is proven here; the
 * integration path through the real Prisma adapter is covered in `e2e.test.ts`.
 */
import { ForbiddenError, UnauthorizedError } from '@nest-admin/core'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import type { AdminOperation, AdminResourceAuth } from '../src/auth/resource.js'
import { AdminModule } from '../src/module.js'
import { createAdminApp } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

const USERS = [
  { id: 'u1', email: 'ada@example.com', name: 'Ada', age: 36, active: true, role: 'ADMIN' },
]

const seeded = () => new InMemoryAdapter({ User: USERS, Post: [] })

const apps: INestApplication[] = []

async function appWith(
  resourceAuth: AdminResourceAuth,
  adapter = seeded(),
): Promise<INestApplication> {
  const app = await createAdminApp(adapter, unsafeAllowAllRequests(), resourceAuth)
  apps.push(app)
  return app
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
})

/** Allows everything except the named models. */
const denyModels = (...denied: string[]): AdminResourceAuth => ({
  authorize: ({ model }) => !denied.includes(model),
})

/** Allows everything except the named operations. */
const denyOperations = (...denied: AdminOperation[]): AdminResourceAuth => ({
  authorize: ({ operation }) => !denied.includes(operation),
})

/** Every route that addresses a model, as [method, path, body]. */
const MODEL_ROUTES = [
  ['get', '/admin/User', undefined],
  ['get', '/admin/User/u1', undefined],
  ['post', '/admin/User', { email: 'new@example.com', name: 'New' }],
  ['patch', '/admin/User/u1', { name: 'Changed' }],
  ['delete', '/admin/User/u1', undefined],
] as const

function send(
  app: INestApplication,
  method: (typeof MODEL_ROUTES)[number][0],
  path: string,
  body?: Record<string, unknown>,
): request.Test {
  const agent = request(app.getHttpServer())
  const test =
    method === 'get'
      ? agent.get(path)
      : method === 'post'
        ? agent.post(path)
        : method === 'patch'
          ? agent.patch(path)
          : agent.delete(path)

  return body === undefined ? test : test.send(body)
}

describe('configuration', () => {
  it('defaults to allowing every model when omitted', async () => {
    const app = await createAdminApp(seeded(), unsafeAllowAllRequests())
    apps.push(app)

    const { body } = await request(app.getHttpServer()).get('/admin/meta').expect(200)
    expect(body.data.models.map((m: { name: string }) => m.name)).toEqual(['User', 'Post'])
  })

  it('rejects a resourceAuth without an authorize method', () => {
    expect(() =>
      AdminModule.forRoot({
        adapter: seeded(),
        auth: unsafeAllowAllRequests(),
        resourceAuth: {} as never,
      }),
    ).toThrow(/authorize\(resource\)/)
  })

  it('keeps two module instances independent', async () => {
    const open = await appWith(denyModels())
    const closed = await appWith(denyModels('User'))

    await request(open.getHttpServer()).get('/admin/User').expect(200)
    await request(closed.getHttpServer()).get('/admin/User').expect(403)
    await request(open.getHttpServer()).get('/admin/User').expect(200)
  })
})

describe('CRUD enforcement', () => {
  for (const [method, path, body] of MODEL_ROUTES) {
    it(`allows ${method.toUpperCase()} ${path} when permitted`, async () => {
      const app = await appWith(denyModels('Post'))
      const response = await send(app, method, path, body)

      expect([200, 201]).toContain(response.status)
    })
  }

  for (const [method, path, body] of MODEL_ROUTES) {
    it(`denies ${method.toUpperCase()} ${path} when the model is denied`, async () => {
      const app = await appWith(denyModels('User'))
      const response = await send(app, method, path, body).expect(403)

      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('FORBIDDEN')
    })
  }

  it('denies one model without affecting another', async () => {
    const app = await appWith(denyModels('Post'))

    await request(app.getHttpServer()).get('/admin/User').expect(200)
    await request(app.getHttpServer()).get('/admin/Post').expect(403)
  })
})

describe('metadata filtering', () => {
  const modelNames = (body: { data: { models: { name: string }[] } }) =>
    body.data.models.map((m) => m.name)

  it('returns every model when all are permitted', async () => {
    const app = await appWith(denyModels())
    const { body } = await request(app.getHttpServer()).get('/admin/meta').expect(200)

    expect(modelNames(body)).toEqual(['User', 'Post'])
  })

  it('hides a denied model', async () => {
    const app = await appWith(denyModels('Post'))
    const { body } = await request(app.getHttpServer()).get('/admin/meta').expect(200)

    expect(modelNames(body)).toEqual(['User'])
  })

  it('returns an empty model list when everything is denied', async () => {
    const app = await appWith(denyModels('User', 'Post'))
    const { body } = await request(app.getHttpServer()).get('/admin/meta').expect(200)

    // Still a 200 with a valid document - an empty schema, not an error.
    expect(body.success).toBe(true)
    expect(body.data.models).toEqual([])
  })

  it('leaks nothing about a denied model anywhere in the payload', async () => {
    const app = await appWith(denyModels('Post'))
    const { text } = await request(app.getHttpServer()).get('/admin/meta').expect(200)

    // Not the name, not its fields, not its relations. `User.posts` is a
    // relation *to* Post, so its absence is part of the check.
    expect(text).not.toContain('Post')
    expect(text).not.toContain('posts')
    expect(text).not.toContain('author')
    expect(text).not.toContain('title')
  })

  it('drops only the dangling relation, not the rest of the visible model', async () => {
    const app = await appWith(denyModels('Post'))
    const { body } = await request(app.getHttpServer()).get('/admin/meta').expect(200)

    const user = body.data.models[0]
    const names = user.fields.map((f: { name: string }) => f.name)

    // `posts` pointed at the hidden model and is gone; everything else stays.
    expect(names).not.toContain('posts')
    expect(names).toEqual(['id', 'email', 'name', 'age', 'active', 'role', 'createdAt'])
    expect(user.primaryKey).toEqual(['id'])
  })

  it('keeps relations when both ends are visible', async () => {
    const app = await appWith(denyModels())
    const { body } = await request(app.getHttpServer()).get('/admin/meta').expect(200)

    const posts = body.data.models[0].fields.find((f: { name: string }) => f.name === 'posts')
    expect(posts.relation).toMatchObject({ targetModel: 'Post', cardinality: 'many' })
    // The shape is resolved from the other half, which is present here.
    expect(posts.relation.shape).toBe('one-to-many')
  })

  it('does not signal a denied model through an error', async () => {
    const app = await appWith(denyModels('Post'))
    const response = await request(app.getHttpServer()).get('/admin/meta')

    // A 403 here would itself confirm that a hidden model exists.
    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
  })

  it('treats a thrown ForbiddenError as "hide", not as a failure', async () => {
    const app = await appWith({
      authorize({ model }) {
        if (model === 'Post') throw new ForbiddenError()
      },
    })
    const { body } = await request(app.getHttpServer()).get('/admin/meta').expect(200)

    expect(modelNames(body)).toEqual(['User'])
  })

  it('still emits only the documented DTO keys for visible models', async () => {
    const app = await appWith(denyModels('Post'))
    const { body } = await request(app.getHttpServer()).get('/admin/meta').expect(200)

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
      expect(Object.keys(model).sort()).toEqual(['displayField', 'fields', 'name', 'primaryKey'])
      for (const field of model.fields) {
        for (const key of Object.keys(field)) expect(allowed).toContain(key)
      }
    }
  })

  it('carries no ORM vocabulary after filtering', async () => {
    const app = await appWith(denyModels('Post'))
    const { text } = await request(app.getHttpServer()).get('/admin/meta').expect(200)

    expect(text.toLowerCase()).not.toContain('prisma')
    expect(text.toLowerCase()).not.toContain('dmmf')
  })
})

describe('operation-aware policy', () => {
  it('receives the operation for every route', async () => {
    const seen: AdminOperation[] = []
    const app = await appWith({
      authorize({ operation }) {
        seen.push(operation)
        return true
      },
    })
    const http = () => request(app.getHttpServer())

    await http().get('/admin/meta').expect(200)
    await http().get('/admin/User').expect(200)
    await http().get('/admin/User/u1').expect(200)
    await http().post('/admin/User').send({ email: 'op@example.com', name: 'Op' }).expect(201)
    await http().patch('/admin/User/u1').send({ name: 'Op2' }).expect(200)
    await http().delete('/admin/User/u1').expect(200)

    expect(seen).toContain('metadata')
    expect(seen).toContain('list')
    expect(seen).toContain('read')
    expect(seen).toContain('create')
    expect(seen).toContain('update')
    expect(seen).toContain('delete')
  })

  it('supports a read-only resource', async () => {
    const app = await appWith(denyOperations('create', 'update', 'delete'))
    const http = () => request(app.getHttpServer())

    await http().get('/admin/meta').expect(200)
    await http().get('/admin/User').expect(200)
    await http().get('/admin/User/u1').expect(200)

    await http().post('/admin/User').send({ email: 'no@example.com', name: 'No' }).expect(403)
    await http().patch('/admin/User/u1').send({ name: 'No' }).expect(403)
    await http().delete('/admin/User/u1').expect(403)
  })

  it('can hide a model from metadata while still permitting direct access', async () => {
    // Not a recommendation - it proves metadata and CRUD are decided
    // independently, which is what makes read-only and hidden-but-linked
    // resources expressible.
    const app = await appWith({ authorize: ({ operation }) => operation !== 'metadata' })
    const http = () => request(app.getHttpServer())

    expect((await http().get('/admin/meta').expect(200)).body.data.models).toEqual([])
    await http().get('/admin/User').expect(200)
  })

  it('receives the model name for every model route', async () => {
    const seen: string[] = []
    const app = await appWith({
      authorize({ model }) {
        seen.push(model)
        return true
      },
    })

    await request(app.getHttpServer()).get('/admin/Post').expect(200)
    expect(seen).toContain('Post')
  })

  it('receives the execution context, so the host can read its own principal', async () => {
    let seenPath: string | undefined
    const app = await appWith({
      authorize({ context }) {
        const req = context.switchToHttp().getRequest<{ path?: string; url?: string }>()
        seenPath = req.path ?? req.url
        return true
      },
    })

    await request(app.getHttpServer()).get('/admin/User/u1').expect(200)
    expect(seenPath).toContain('/admin/User/u1')
  })
})

describe('the adapter is never reached for a denied resource', () => {
  it('does not list', async () => {
    const adapter = seeded()
    const app = await appWith(denyModels('User'), adapter)

    await request(app.getHttpServer()).get('/admin/User').expect(403)
    expect(adapter.lastListQuery).toBeUndefined()
  })

  it('does not create', async () => {
    const adapter = seeded()
    const app = await appWith(denyModels('User'), adapter)

    await request(app.getHttpServer())
      .post('/admin/User')
      .send({ email: 'blocked@example.com', name: 'Blocked' })
      .expect(403)

    // Authorization ran before the write, so nothing was inserted.
    const open = await appWith(denyModels(), adapter)
    const { body } = await request(open.getHttpServer()).get('/admin/User').expect(200)
    expect(body.data).toHaveLength(1)
  })

  it('does not delete', async () => {
    const adapter = seeded()
    const app = await appWith(denyModels('User'), adapter)

    await request(app.getHttpServer()).delete('/admin/User/u1').expect(403)

    const open = await appWith(denyModels(), adapter)
    const { body } = await request(open.getHttpServer()).get('/admin/User/u1').expect(200)
    expect(body.data.id).toBe('u1')
  })

  it('filtering metadata does not read any records', async () => {
    const adapter = seeded()
    const app = await appWith(denyModels('Post'), adapter)

    await request(app.getHttpServer()).get('/admin/meta').expect(200)
    expect(adapter.lastListQuery).toBeUndefined()
  })
})

describe('asynchronous policies', () => {
  const async$ = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(value), 1))

  it('allows on a resolved true', async () => {
    const app = await appWith({ authorize: () => async$(true) })
    await request(app.getHttpServer()).get('/admin/User').expect(200)
  })

  it('denies on a resolved false', async () => {
    const app = await appWith({ authorize: () => async$(false) })
    const { body } = await request(app.getHttpServer()).get('/admin/User').expect(403)
    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('denies on a rejected ForbiddenError', async () => {
    const app = await appWith({ authorize: () => Promise.reject(new ForbiddenError()) })
    await request(app.getHttpServer()).get('/admin/User').expect(403)
  })

  it('hides the model when metadata filtering rejects with ForbiddenError', async () => {
    const app = await appWith({
      authorize: ({ model }) =>
        model === 'Post' ? Promise.reject(new ForbiddenError()) : async$(true),
    })
    const { body } = await request(app.getHttpServer()).get('/admin/meta').expect(200)

    expect(body.data.models.map((m: { name: string }) => m.name)).toEqual(['User'])
  })

  it('fails safely on an unexpected rejection', async () => {
    const app = await appWith({
      authorize: () => Promise.reject(new Error('policy backend timed out at /srv/policy.ts:9')),
    })
    const { body, text } = await request(app.getHttpServer()).get('/admin/User').expect(500)

    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(text).not.toContain('/srv/policy')
  })
})

describe('failing closed', () => {
  it('does not allow the request when the policy throws unexpectedly', async () => {
    const app = await appWith({
      authorize() {
        throw new Error('bug in host policy: cannot read property roles of undefined')
      },
    })
    const { body } = await request(app.getHttpServer()).get('/admin/User').expect(500)

    expect(body.error.code).toBe('INTERNAL_ERROR')
  })

  it('does not silently hide models when the metadata policy throws unexpectedly', async () => {
    // Hiding on a bug would quietly reshape the schema a client is shown, which
    // reads as "this model was deleted". A 500 says what actually happened.
    const app = await appWith({
      authorize() {
        throw new Error('policy backend unreachable')
      },
    })
    const { body } = await request(app.getHttpServer()).get('/admin/meta').expect(500)

    expect(body.error.code).toBe('INTERNAL_ERROR')
  })

  it('leaks nothing from a failing policy', async () => {
    const app = await appWith({
      authorize() {
        throw new Error('token eyJhbGciOiJIUzI1NiJ9.secret rejected at /srv/app/policy.ts:42')
      },
    })
    const { body, text } = await request(app.getHttpServer()).get('/admin/User').expect(500)

    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(text).not.toContain('/srv/app')
    expect(JSON.stringify(body)).not.toContain('stack')
  })
})

describe('composition with request-level authentication', () => {
  it('401 takes precedence over resource authorization', async () => {
    const adapter = seeded()
    const app = await createAdminApp(
      adapter,
      {
        authorize() {
          throw new UnauthorizedError()
        },
      },
      denyModels('User'),
    )
    apps.push(app)

    // Authentication runs in the guard, before the controller reaches the
    // service - so an anonymous caller gets 401, never 403.
    const { body } = await request(app.getHttpServer()).get('/admin/User').expect(401)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('403 from resource authorization applies once authenticated', async () => {
    const app = await appWith(denyModels('User'))
    const { body } = await request(app.getHttpServer()).get('/admin/User').expect(403)

    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('existing error mapping is unchanged for permitted models', async () => {
    const app = await appWith(denyModels())
    const http = () => request(app.getHttpServer())

    expect((await http().get('/admin/Nope').expect(404)).body.error.code).toBe('MODEL_NOT_FOUND')
    expect((await http().get('/admin/User/missing').expect(404)).body.error.code).toBe(
      'RECORD_NOT_FOUND',
    )
    expect((await http().get('/admin/User?page=0').expect(400)).body.error.code).toBe(
      'INVALID_QUERY',
    )
  })
})
