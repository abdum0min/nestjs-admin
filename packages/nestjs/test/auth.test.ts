/**
 * The authentication boundary, exercised over real HTTP.
 *
 * A guard can be correctly implemented and incorrectly attached, so every
 * assertion here goes through a booted Nest application rather than calling
 * the guard directly. The route matrix is exhaustive on purpose: a single
 * unprotected route is the whole failure.
 */
import { ForbiddenError, UnauthorizedError } from '@nest-admin/core'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import type { AdminAuth } from '../src/auth/contract.js'
import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import { AdminModule } from '../src/module.js'
import { createAdminApp } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

const USERS = [
  { id: 'u1', email: 'ada@example.com', name: 'Ada', age: 36, active: true, role: 'ADMIN' },
]

const seeded = () => new InMemoryAdapter({ User: USERS, Post: [] })

/** Denies every request as unauthenticated. */
const denyAnonymous: AdminAuth = {
  authorize() {
    throw new UnauthorizedError()
  },
}

/** Authenticates, then refuses. */
const denyForbidden: AdminAuth = {
  authorize() {
    throw new ForbiddenError()
  },
}

const apps: INestApplication[] = []

async function appWith(auth: AdminAuth): Promise<INestApplication> {
  const app = await createAdminApp(seeded(), auth)
  apps.push(app)
  return app
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
})

/** Every admin route, as [method, path, body]. */
const ROUTES = [
  ['get', '/admin/meta', undefined],
  ['get', '/admin/User', undefined],
  ['get', '/admin/User/u1', undefined],
  ['post', '/admin/User', { email: 'new@example.com', name: 'New' }],
  ['patch', '/admin/User/u1', { name: 'Changed' }],
  ['delete', '/admin/User/u1', undefined],
] as const

type RouteMethod = (typeof ROUTES)[number][0]

function send(
  app: INestApplication,
  method: RouteMethod,
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

describe('module configuration', () => {
  it('accepts an auth implementation', async () => {
    const app = await appWith(unsafeAllowAllRequests())
    await request(app.getHttpServer()).get('/admin/meta').expect(200)
  })

  it('refuses to construct without auth, rather than defaulting to public', () => {
    expect(() => AdminModule.forRoot({ adapter: seeded(), auth: undefined as never })).toThrow(
      /requires an `auth` implementation/,
    )
  })

  it('refuses an auth object with no authorize method', () => {
    expect(() => AdminModule.forRoot({ adapter: seeded(), auth: {} as never })).toThrow(
      /authorize\(context\)/,
    )
  })

  it('still refuses to construct without an adapter', () => {
    expect(() =>
      AdminModule.forRoot({ adapter: undefined as never, auth: unsafeAllowAllRequests() }),
    ).toThrow(/requires an `adapter`/)
  })

  it('keeps two module instances independent', async () => {
    const open = await appWith(unsafeAllowAllRequests())
    const closed = await appWith(denyAnonymous)

    // No shared mutable auth state: one app allowing does not affect the other.
    await request(open.getHttpServer()).get('/admin/meta').expect(200)
    await request(closed.getHttpServer()).get('/admin/meta').expect(401)
    await request(open.getHttpServer()).get('/admin/meta').expect(200)
  })
})

describe('401 - no authenticated identity', () => {
  for (const [method, path, body] of ROUTES) {
    it(`${method.toUpperCase()} ${path}`, async () => {
      const app = await appWith(denyAnonymous)
      const response = await send(app, method, path, body).expect(401)

      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('UNAUTHORIZED')
    })
  }
})

describe('403 - authenticated but not permitted', () => {
  for (const [method, path, body] of ROUTES) {
    it(`${method.toUpperCase()} ${path}`, async () => {
      const app = await appWith(denyForbidden)
      const response = await send(app, method, path, body).expect(403)

      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('FORBIDDEN')
    })
  }
})

describe('401 and 403 are genuinely distinct', () => {
  it('does not collapse the two', async () => {
    const anonymous = await appWith(denyAnonymous)
    const forbidden = await appWith(denyForbidden)

    const a = await request(anonymous.getHttpServer()).get('/admin/User')
    const f = await request(forbidden.getHttpServer()).get('/admin/User')

    expect(a.status).toBe(401)
    expect(f.status).toBe(403)
    expect(a.body.error.code).not.toBe(f.body.error.code)
  })
})

describe('permitted requests still work', () => {
  it('allows every operation once authorized', async () => {
    const app = await appWith({ authorize: () => undefined })
    const http = () => request(app.getHttpServer())

    await http().get('/admin/meta').expect(200)
    await http().get('/admin/User').expect(200)
    await http().get('/admin/User/u1').expect(200)

    const created = await http()
      .post('/admin/User')
      .send({ email: 'new@example.com', name: 'New' })
      .expect(201)

    const id = created.body.data.id as string
    await http().patch(`/admin/User/${id}`).send({ name: 'Renamed' }).expect(200)
    await http().delete(`/admin/User/${id}`).expect(200)
  })

  it('supports asynchronous authorization', async () => {
    const app = await appWith({
      async authorize() {
        await new Promise((resolve) => setTimeout(resolve, 1))
      },
    })
    await request(app.getHttpServer()).get('/admin/meta').expect(200)
  })

  it('supports synchronous authorization', async () => {
    const app = await appWith({ authorize: (): void => undefined })
    await request(app.getHttpServer()).get('/admin/meta').expect(200)
  })

  it('passes the execution context so the host can read its own principal', async () => {
    let seenPath: string | undefined
    let seenModel: unknown

    const app = await appWith({
      authorize(context) {
        const req = context.switchToHttp().getRequest<{
          path?: string
          url?: string
          params?: Record<string, unknown>
        }>()
        seenPath = req.path ?? req.url
        seenModel = req.params?.['model']
      },
    })

    await request(app.getHttpServer()).get('/admin/User/u1').expect(200)

    expect(seenPath).toContain('/admin/User/u1')
    // The model is reachable, which is what makes host-side per-model checks
    // possible today without any new API.
    expect(seenModel).toBe('User')
  })
})

describe('failing closed', () => {
  it('treats a returned false as a denial rather than an allow', async () => {
    const app = await appWith({ authorize: () => false })
    const { body } = await request(app.getHttpServer()).get('/admin/User').expect(403)

    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('treats a returned true as an allow', async () => {
    const app = await appWith({ authorize: () => true })
    await request(app.getHttpServer()).get('/admin/User').expect(200)
  })

  it('does not allow the request when the host auth itself throws', async () => {
    // A bug in the host's auth code must never become an accidental allow.
    const app = await appWith({
      authorize() {
        throw new Error('bug in host auth: cannot read property token of undefined')
      },
    })
    const { body } = await request(app.getHttpServer()).get('/admin/User').expect(500)

    expect(body.error.code).toBe('INTERNAL_ERROR')
  })

  it('does not allow the request when the host auth rejects', async () => {
    const app = await appWith({
      authorize: () => Promise.reject(new Error('upstream identity service timed out')),
    })
    await request(app.getHttpServer()).get('/admin/User').expect(500)
  })
})

describe('the boundary cannot be bypassed', () => {
  it('protects /admin/meta, which exposes the whole schema', async () => {
    const app = await appWith(denyAnonymous)
    const { body, text } = await request(app.getHttpServer()).get('/admin/meta').expect(401)

    expect(body.error.code).toBe('UNAUTHORIZED')
    // Nothing about the schema may appear in a rejected response.
    expect(text).not.toContain('models')
    expect(text).not.toContain('User')
  })

  it('is not bypassed by route ordering or path shape', async () => {
    const app = await appWith(denyAnonymous)

    for (const path of [
      '/admin/meta',
      '/admin/meta/',
      '/admin/Nope',
      '/admin/__proto__',
      '/admin/User/u1',
      '/admin/User?page=1&sort=name:asc',
    ]) {
      const response = await request(app.getHttpServer()).get(path)
      expect([401, 404]).toContain(response.status)
      if (response.status === 401) expect(response.body.error.code).toBe('UNAUTHORIZED')
    }
  })

  it('rejects before touching the adapter at all', async () => {
    const adapter = seeded()
    const app = await createAdminApp(adapter, denyAnonymous)
    apps.push(app)

    await request(app.getHttpServer()).get('/admin/User?sort=name:asc').expect(401)

    // The adapter records every list it serves; auth ran first, so none happened.
    expect(adapter.lastListQuery).toBeUndefined()
  })

  it('does not reveal whether an unknown model exists', async () => {
    const app = await appWith(denyAnonymous)
    const known = await request(app.getHttpServer()).get('/admin/User')
    const unknown = await request(app.getHttpServer()).get('/admin/Nope')

    // Both 401 - a rejected caller learns nothing about the schema.
    expect(known.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(known.body).toEqual(unknown.body)
  })
})

describe('auth failures leak nothing', () => {
  it('does not echo credentials or internals from a thrown host error', async () => {
    const app = await appWith({
      authorize() {
        throw new Error('invalid bearer eyJhbGciOiJIUzI1NiJ9.secret at /srv/app/auth.ts:42')
      },
    })
    const { body, text } = await request(app.getHttpServer()).get('/admin/User').expect(500)

    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(text).not.toContain('/srv/app')
    expect(text).not.toContain('bearer')
    expect(JSON.stringify(body)).not.toContain('stack')
  })

  it('keeps the standard envelope for auth failures', async () => {
    for (const auth of [denyAnonymous, denyForbidden]) {
      const app = await appWith(auth)
      const { body } = await request(app.getHttpServer()).get('/admin/User')

      expect(Object.keys(body).sort()).toEqual(['error', 'success'])
      expect(Object.keys(body.error).sort()).toEqual(['code', 'message'])
    }
  })

  it('uses a message that does not say why authentication failed', async () => {
    const app = await appWith(denyAnonymous)
    const { body } = await request(app.getHttpServer()).get('/admin/User').expect(401)

    // Distinguishing "expired" from "malformed" from "absent" helps a prober.
    for (const leak of ['expired', 'malformed', 'missing header', 'token', 'cookie']) {
      expect(body.error.message.toLowerCase()).not.toContain(leak)
    }
  })

  it('lets a host supply its own safe message', async () => {
    const app = await appWith({
      authorize() {
        throw new ForbiddenError('Admin access is limited to staff accounts.')
      },
    })
    const { body } = await request(app.getHttpServer()).get('/admin/User').expect(403)

    expect(body.error.message).toBe('Admin access is limited to staff accounts.')
  })
})

describe('behaviour after successful authentication is unchanged', () => {
  it('still maps Core errors correctly', async () => {
    const app = await appWith(unsafeAllowAllRequests())
    const http = () => request(app.getHttpServer())

    expect((await http().get('/admin/Nope').expect(404)).body.error.code).toBe('MODEL_NOT_FOUND')
    expect((await http().get('/admin/User/missing').expect(404)).body.error.code).toBe(
      'RECORD_NOT_FOUND',
    )
    expect((await http().get('/admin/User?sort=nope:asc').expect(400)).body.error.code).toBe(
      'FIELD_NOT_FOUND',
    )
    expect((await http().get('/admin/User?page=0').expect(400)).body.error.code).toBe(
      'INVALID_QUERY',
    )
  })

  it('still rejects prototype-ish model names', async () => {
    const app = await appWith(unsafeAllowAllRequests())
    const { body } = await request(app.getHttpServer()).get('/admin/__proto__').expect(404)

    expect(body.error.code).toBe('MODEL_NOT_FOUND')
  })
})
