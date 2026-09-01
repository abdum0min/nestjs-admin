/**
 * Roles, over real HTTP.
 *
 * Roles are sugar: they compile into an `AdminResourceAuth` and then stop
 * existing. So most of what is asserted here is that the sugar produces the
 * policy someone would have written by hand - and, just as importantly, that
 * an admin which never mentions roles is untouched by their existence.
 *
 * The awkward cases are the ones worth having: a role nobody defined, a request
 * with no role at all, a model a role never mentions, and an action that is not
 * implied by permission to update.
 */
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import type { AdminResourceAuth } from '../src/auth/resource.js'
import type { AdminRoles, RoleResolver } from '../src/auth/roles.js'
import { AdminModule } from '../src/module.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'
import { Test } from '@nestjs/testing'

const USERS = [
  { id: 'u1', email: 'ada@acme.test', name: 'Ada', age: 36, active: true, role: 'ADMIN' },
  { id: 'u2', email: 'bob@acme.test', name: 'Bob', age: 41, active: false, role: 'USER' },
]

const POSTS = [{ id: 'p1', title: 'One', body: 'x', authorId: 'u1' }]

const seeded = () => new InMemoryAdapter({ User: USERS, Post: POSTS })

/** The role travels in a header, so each test can pick one per request. */
const roleOf: RoleResolver = (context) =>
  context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>().headers[
    'x-role'
  ]

const apps: INestApplication[] = []

async function appWith(options: {
  roles?: AdminRoles
  roleOf?: RoleResolver
  resourceAuth?: AdminResourceAuth
}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: seeded(),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        ...(options.roles ? { roles: options.roles } : {}),
        ...(options.roleOf ? { roleOf: options.roleOf } : {}),
        ...(options.resourceAuth ? { resourceAuth: options.resourceAuth } : {}),
      }),
    ],
  }).compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  apps.push(app)
  return app
}

const as = (app: INestApplication, role?: string) => {
  const agent = request(app.getHttpServer())
  return {
    get: (path: string) =>
      role === undefined ? agent.get(path) : agent.get(path).set('x-role', role),
    post: (path: string) =>
      role === undefined ? agent.post(path) : agent.post(path).set('x-role', role),
    patch: (path: string) =>
      role === undefined ? agent.patch(path) : agent.patch(path).set('x-role', role),
    delete: (path: string) =>
      role === undefined ? agent.delete(path) : agent.delete(path).set('x-role', role),
  }
}

const ROLES: AdminRoles = {
  admin: '*',
  editor: { models: { Post: ['metadata', 'list', 'read', 'create', 'update'] } },
  reader: { models: { User: ['metadata', 'list', 'read'], Post: ['metadata', 'list', 'read'] } },
  scoped: {
    models: { User: ['metadata', 'list', 'read'] },
    scope: ({ model }) =>
      model === 'User' ? [{ field: 'active', operator: 'eq', value: true }] : undefined,
  },
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
})

describe('what a role may do', () => {
  it('lets the star role do everything', async () => {
    const app = await appWith({ roles: ROLES, roleOf })

    await as(app, 'admin').get('/admin/User').expect(200)
    await as(app, 'admin').patch('/admin/User/u1').send({ name: 'A' }).expect(200)
    await as(app, 'admin').delete('/admin/User/u1').expect(200)
  })

  it('permits exactly the operations listed', async () => {
    const app = await appWith({ roles: ROLES, roleOf })

    await as(app, 'editor').get('/admin/Post').expect(200)
    await as(app, 'editor').patch('/admin/Post/p1').send({ title: 'B' }).expect(200)
    // `delete` is not on the list.
    await as(app, 'editor').delete('/admin/Post/p1').expect(403)
  })

  it('hides a model the role never mentions, rather than refusing it', async () => {
    // Not read-only - absent. The interface renders from metadata, so a model
    // that is not there is one it never learns exists.
    const app = await appWith({ roles: ROLES, roleOf })

    const { body } = await as(app, 'editor').get('/admin/meta').expect(200)
    expect(body.data.models.map((model: { name: string }) => model.name)).toEqual(['Post'])

    await as(app, 'editor').get('/admin/User').expect(403)
  })

  it('reports the operations in the metadata the interface renders from', async () => {
    // The `can` block is what withholds New, Edit and Delete. It has existed
    // since 0.5.0; roles feed it rather than replacing it.
    const app = await appWith({ roles: ROLES, roleOf })

    const { body } = await as(app, 'reader').get('/admin/meta').expect(200)
    const user = body.data.models.find((model: { name: string }) => model.name === 'User')

    expect(user.can).toMatchObject({ list: true, read: true, create: false, update: false })
  })

  it('does not imply an action from permission to update', async () => {
    // An action runs application code and can do anything. Being allowed to
    // edit a post is not being allowed to publish it.
    const app = await appWith({
      roles: { limited: { models: { Post: ['metadata', 'list', 'read', 'update'] } } },
      roleOf,
    })

    await as(app, 'limited').post('/admin/actions/Post/publish/p1').expect(403)
  })
})

describe('a role that carries a scope', () => {
  it('limits the rows as well as the operations', async () => {
    const app = await appWith({ roles: ROLES, roleOf })

    const { body } = await as(app, 'scoped').get('/admin/User').expect(200)
    expect(body.data.map((row: { name: string }) => row.name)).toEqual(['Ada'])
    expect(body.meta.total).toBe(1)
  })

  it('hides a row outside the scope behind a 404', async () => {
    const app = await appWith({ roles: ROLES, roleOf })
    await as(app, 'scoped').get('/admin/User/u2').expect(404)
  })
})

describe('the awkward cases', () => {
  it('denies a role nobody defined', async () => {
    // A typo in `roleOf` must not quietly grant everything.
    const app = await appWith({ roles: ROLES, roleOf })
    await as(app, 'sales').get('/admin/User').expect(403)
  })

  it('denies a request that carries no role at all', async () => {
    const app = await appWith({ roles: ROLES, roleOf })
    await as(app).get('/admin/User').expect(403)
  })

  it('shows no models at all to a role that has none', async () => {
    const app = await appWith({ roles: { nobody: { models: {} } }, roleOf })

    const { body } = await as(app, 'nobody').get('/admin/meta').expect(200)
    expect(body.data.models).toEqual([])
  })
})

describe('roles beside a policy of your own', () => {
  it('requires both to agree', async () => {
    // Fail closed: adding a rule can only remove access, never grant it.
    const app = await appWith({
      roles: { admin: '*' },
      roleOf,
      resourceAuth: { authorize: ({ model }) => model !== 'Post' },
    })

    await as(app, 'admin').get('/admin/User').expect(200)
    await as(app, 'admin').get('/admin/Post').expect(403)
  })

  it('applies both scopes together', async () => {
    const app = await appWith({
      roles: ROLES,
      roleOf,
      resourceAuth: {
        authorize: ({ model }) =>
          model === 'User' ? { filters: [{ field: 'age', operator: 'gt', value: 40 }] } : true,
      },
    })

    // The role scopes to active users, the policy to over-forties. Ada is
    // active but 36; Bob is 41 but inactive. Neither passes both.
    const { body } = await as(app, 'scoped').get('/admin/User').expect(200)
    expect(body.data).toEqual([])
  })
})

describe('an admin that never mentions roles', () => {
  it('behaves exactly as it did before they existed', async () => {
    const app = await appWith({})

    await as(app).get('/admin/User').expect(200)
    await as(app).delete('/admin/User/u1').expect(200)

    const { body } = await as(app).get('/admin/meta').expect(200)
    expect(body.data.models).toHaveLength(2)
  })

  it('refuses to start with roles but no resolver', async () => {
    // Silently denying every request would be a locked-out admin with no
    // explanation. Refusing to boot says which option is missing.
    await expect(appWith({ roles: ROLES })).rejects.toThrow(/roleOf/)
  })

  it('refuses to start with a resolver but no roles', async () => {
    await expect(appWith({ roleOf })).rejects.toThrow(/roles/)
  })
})
