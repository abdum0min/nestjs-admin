/**
 * Row-level scoping, over real HTTP.
 *
 * `AdminResourceAuth` used to answer "may this principal touch this model".
 * It can now answer "yes, but only these rows" by returning filters instead of
 * `true`, and those filters reach the database rather than being applied to
 * what comes back.
 *
 * ## What is actually being tested
 *
 * Not that a filter works - the adapter suites prove that. This proves the
 * eight places a scope has to be applied, because a scope that holds in seven
 * of them is not a scope at all. Every one of these was written by asking
 * "how would someone read a row they should not?" and then trying it.
 *
 * The other half is the negative: an admin that configures no scope must
 * behave exactly as it did before, including issuing no extra queries.
 */
import type { RecordId } from '@nest-admin/core'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import type { AdminResourceAuth } from '../src/auth/resource.js'
import { createAdminApp } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

/** Two tenants. Everything below is about not seeing the other one's rows. */
const USERS = [
  { id: 'u1', email: 'ada@acme.test', name: 'Ada', age: 36, active: true, role: 'ADMIN' },
  { id: 'u2', email: 'bob@acme.test', name: 'Bob', age: 41, active: true, role: 'USER' },
  { id: 'u3', email: 'cy@other.test', name: 'Cy', age: 29, active: false, role: 'USER' },
  { id: 'u4', email: 'dee@other.test', name: 'Dee', age: 33, active: false, role: 'USER' },
]

const POSTS = [
  { id: 'p1', title: 'Acme one', body: 'x', authorId: 'u1' },
  { id: 'p2', title: 'Acme two', body: 'y', authorId: 'u1' },
  { id: 'p3', title: 'Other one', body: 'z', authorId: 'u3' },
]

const seeded = () => new InMemoryAdapter({ User: USERS, Post: POSTS })

/**
 * Everything is permitted; only the *rows* are limited.
 *
 * `active: true` stands in for "this tenant" - the shape of the rule does not
 * matter, only that the policy returns filters rather than a boolean.
 */
const ownTenant: AdminResourceAuth = {
  authorize({ model }) {
    if (model === 'User') return { filters: [{ field: 'active', operator: 'eq', value: true }] }
    if (model === 'Post') return { filters: [{ field: 'authorId', operator: 'eq', value: 'u1' }] }
    return true
  },
}

const apps: INestApplication[] = []

async function appWith(
  resourceAuth?: AdminResourceAuth,
  adapter = seeded(),
): Promise<INestApplication> {
  const app = await createAdminApp(adapter, unsafeAllowAllRequests(), resourceAuth)
  apps.push(app)
  return app
}

const http = (app: INestApplication) => request(app.getHttpServer())

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
})

describe('listing', () => {
  it('returns only the rows the scope covers', async () => {
    const { body } = await http(await appWith(ownTenant))
      .get('/admin/User')
      .expect(200)

    expect(body.data.map((row: { name: string }) => row.name).sort()).toEqual(['Ada', 'Bob'])
  })

  it('counts only those rows, which is the reason this is a filter', async () => {
    // The failure this guards against: filtering after the query would leave
    // `total` at 4, so a page would claim rows the reader may never see and
    // the pager would offer a page that comes back empty.
    const { body } = await http(await appWith(ownTenant))
      .get('/admin/User?perPage=1')
      .expect(200)

    expect(body.meta.total).toBe(2)
  })

  it('combines with the filters the caller asked for', async () => {
    const { body } = await http(await appWith(ownTenant))
      .get('/admin/User?filter=age:gt:40')
      .expect(200)

    // Bob is over 40 and in scope; nobody else is both.
    expect(body.data.map((row: { name: string }) => row.name)).toEqual(['Bob'])
  })

  it('cannot be widened by a filter the caller sends', async () => {
    // The obvious attack: ask for the rows you were not given.
    const { body } = await http(await appWith(ownTenant))
      .get('/admin/User?filter=active:eq:false')
      .expect(200)

    expect(body.data).toEqual([])
  })
})

describe('one record', () => {
  it('answers 404 for a row outside the scope, not 403', async () => {
    // 403 would confirm that u3 exists. "No such record" and "not yours" have
    // to be indistinguishable from outside, or the scope leaks the thing it
    // was added to hide.
    const app = await appWith(ownTenant)

    await http(app).get('/admin/User/u1').expect(200)
    const { body } = await http(app).get('/admin/User/u3').expect(404)
    expect(body.error.code).toBe('RECORD_NOT_FOUND')
  })

  it('refuses to update one', async () => {
    await http(await appWith(ownTenant))
      .patch('/admin/User/u3')
      .send({ name: 'Taken over' })
      .expect(404)
  })

  it('refuses to delete one', async () => {
    await http(await appWith(ownTenant))
      .delete('/admin/User/u3')
      .expect(404)
  })

  it('leaves an in-scope record fully writable', async () => {
    const app = await appWith(ownTenant)

    await http(app).patch('/admin/User/u2').send({ name: 'Bobby' }).expect(200)
    await http(app).delete('/admin/User/u2').expect(200)
  })

  it('does not let a hook see a record the scope refused', async () => {
    // A hook is application code handed an id. It must never be handed one the
    // principal could not have reached - the scope check therefore runs before
    // the hook, not after it.
    const seen: RecordId[] = []
    const app = await createAdminApp(
      seeded(),
      unsafeAllowAllRequests(),
      ownTenant,
      undefined,
      undefined,
      undefined,
      undefined,
      { User: { beforeDelete: ({ id }) => void seen.push(id) } },
    )
    apps.push(app)

    await http(app).delete('/admin/User/u3').expect(404)
    expect(seen).toEqual([])

    // And the same hook does run for a record that is in scope, so the
    // assertion above is about the scope rather than about a hook that was
    // never wired up.
    await http(app).delete('/admin/User/u2').expect(200)
    expect(seen).toEqual(['u2'])
  })
})

describe('deleting several', () => {
  it('deletes the rows in scope and reports the rest as failures', async () => {
    // Not a failed request: the caller ticked boxes, and the honest answer is
    // which ones went and which did not.
    const { body } = await http(await appWith(ownTenant))
      .delete('/admin/User')
      .send({ ids: ['u2', 'u3'] })
      .expect(200)

    expect(body.data.deleted).toEqual(['u2'])
    expect(body.data.failed).toHaveLength(1)
    expect(body.data.failed[0].id).toBe('u3')
  })

  it('leaves the out-of-scope record where it was', async () => {
    const adapter = seeded()
    const app = await appWith(ownTenant, adapter)

    await http(app)
      .delete('/admin/User')
      .send({ ids: ['u3'] })
      .expect(200)

    // Read without the scope to prove it is still there.
    expect(await adapter.findOne('User', 'u3')).not.toBeNull()
  })
})

describe('across a relation', () => {
  it('scopes the records on the far side', async () => {
    const { body } = await http(await appWith(ownTenant))
      .get('/admin/User/u1/posts')
      .expect(200)

    expect(body.data.map((row: { title: string }) => row.title).sort()).toEqual([
      'Acme one',
      'Acme two',
    ])
    expect(body.meta.total).toBe(2)
  })

  it('refuses to walk through a parent the scope does not cover', async () => {
    // The back door: `u3` is hidden, so its children must be unreachable
    // through it even though Post itself is a model this principal may list.
    await http(await appWith(ownTenant))
      .get('/admin/User/u3/posts')
      .expect(404)
  })
})

describe('the dashboard', () => {
  it('counts only the rows in scope', async () => {
    // A count is a number about rows. An unscoped one reports on records the
    // reader may not open, which is the same leak by a quieter route.
    const { body } = await http(await appWith(ownTenant))
      .get('/admin/dashboard')
      .expect(200)

    const users = body.data.widgets.find(
      (widget: { kind: string; model: string }) =>
        widget.kind === 'count' && widget.model === 'User',
    )

    expect(users.data.value).toBe(2)
  })
})

describe('what a scope does not change', () => {
  it('treats an empty filter list as no scope at all', async () => {
    // A policy that builds its filters conditionally should not have to
    // remember to return a different type when it built none.
    const { body } = await http(await appWith({ authorize: () => ({ filters: [] }) }))
      .get('/admin/User')
      .expect(200)

    expect(body.data).toHaveLength(4)
  })

  it('still accepts a policy that answers with a boolean', async () => {
    const app = await appWith({ authorize: ({ model }) => model !== 'Post' })

    expect((await http(app).get('/admin/User').expect(200)).body.data).toHaveLength(4)
    await http(app).get('/admin/Post').expect(403)
  })

  it('issues no extra query when nothing is scoped', async () => {
    // The cost of scoping is one membership query per addressed record. An
    // admin that configures nothing must not pay it - which is most of them.
    const adapter = seeded()
    const list = vi.spyOn(adapter, 'list')

    await http(await appWith(undefined, adapter))
      .get('/admin/User/u1')
      .expect(200)

    expect(list).not.toHaveBeenCalled()
  })

  it('behaves exactly as before with no policy at all', async () => {
    const app = await appWith()

    expect((await http(app).get('/admin/User').expect(200)).body.meta.total).toBe(4)
    await http(app).get('/admin/User/u3').expect(200)
    await http(app).delete('/admin/User/u3').expect(200)
  })
})
