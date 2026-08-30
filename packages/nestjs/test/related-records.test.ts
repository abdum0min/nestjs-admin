/**
 * The related-records routes.
 *
 * `GET /admin/:model/:id/:relation` returns records of the *target* model, so
 * the authorization question is not "may this caller open the parent" but both
 * that and "may this caller list the target". Most of what follows is about
 * that second half, because it is the one a nested route makes easy to forget.
 */
import { ForbiddenError } from '@nest-admin/core'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import type { AdminResourceAuth } from '../src/auth/resource.js'
import { createAdminApp } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const seed = () => ({
  User: [
    { id: 'u1', email: 'ada@example.com', name: 'Ada' },
    { id: 'u2', email: 'alan@example.com', name: 'Alan' },
  ],
  Post: [
    { id: 'p1', title: 'First', authorId: 'u1' },
    { id: 'p2', title: 'Second', authorId: 'u1' },
    { id: 'p3', title: 'Third', authorId: 'u2' },
  ],
})

const boot = async (resourceAuth?: AdminResourceAuth) => {
  app = await createAdminApp(new InMemoryAdapter(seed()), undefined, resourceAuth)
  return app.getHttpServer()
}

/** Denies exactly the named operations on the named model. */
const deny = (model: string, ...operations: string[]): AdminResourceAuth => ({
  authorize: ({ model: name, operation }) => !(name === model && operations.includes(operation)),
})

describe('listing related records', () => {
  it('returns the children of one parent', async () => {
    const server = await boot()

    const { body } = await request(server).get('/admin/User/u1/posts').expect(200)

    expect(body.data.map((record: { id: string }) => record.id)).toEqual(['p1', 'p2'])
    expect(body.meta.total).toBe(2)
  })

  it('does not return the other parent children', async () => {
    const server = await boot()

    const { body } = await request(server).get('/admin/User/u2/posts').expect(200)

    expect(body.data.map((record: { id: string }) => record.id)).toEqual(['p3'])
  })

  it('paginates, because the count is a property of the data', async () => {
    const server = await boot()

    const { body } = await request(server).get('/admin/User/u1/posts?page=2&perPage=1').expect(200)

    expect(body.data).toHaveLength(1)
    expect(body.meta).toMatchObject({ total: 2, page: 2, perPage: 1 })
  })

  it('404s for a parent that does not exist, rather than an empty page', async () => {
    // An empty page would read as "this record has no children".
    const server = await boot()

    const { body } = await request(server).get('/admin/User/nope/posts').expect(404)

    expect(body.error.code).toBe('RECORD_NOT_FOUND')
  })

  it('400s for a field that is not a to-many relation', async () => {
    const server = await boot()

    for (const path of ['/admin/User/u1/email', '/admin/User/u1/nope']) {
      const { body } = await request(server).get(path).expect(400)
      expect(body.error.code).toBe('FIELD_NOT_FOUND')
    }
  })

  it('404s for a parent model that is not exposed', async () => {
    const server = await boot()

    await request(server).get('/admin/Nope/u1/posts').expect(404)
  })
})

describe('authorization on a nested route', () => {
  it('needs read on the parent', async () => {
    const server = await boot(deny('User', 'read'))

    await request(server).get('/admin/User/u1/posts').expect(403)
  })

  it('needs list on the target, not just read on the parent', async () => {
    // The route returns Post records. A principal who may not list Posts must
    // not receive them through a relation.
    const server = await boot(deny('Post', 'list'))

    await request(server).get('/admin/User/u1/posts').expect(403)
  })

  it('allows it when both are permitted', async () => {
    const server = await boot(deny('Post', 'delete'))

    await request(server).get('/admin/User/u1/posts').expect(200)
  })

  it('treats a metadata denial exactly as the top-level route does', async () => {
    // Hiding a model from `/admin/meta` and refusing to list it are separate
    // operations, on purpose - `metadata` controls the document, `list`
    // controls the records. A principal denied only `metadata` can still list
    // Post directly, so the nested route must not be stricter: an inconsistency
    // here would be a rule that exists in one place and not the other.
    const server = await boot({
      authorize: ({ model, operation }) => {
        if (model === 'Post' && operation === 'metadata') throw new ForbiddenError()
        return true
      },
    })

    await request(server).get('/admin/Post').expect(200)
    await request(server).get('/admin/User/u1/posts').expect(200)
  })

  it('is unreachable when the target is excluded from the admin', async () => {
    // `resources` is structural rather than per-principal, so the target is not
    // part of this admin at all and the relation reads as an unknown field.
    app = await createAdminApp(new InMemoryAdapter(seed()), undefined, undefined, undefined, {
      exclude: ['Post'],
    })

    const { body } = await request(app.getHttpServer()).get('/admin/User/u1/posts').expect(400)

    expect(body.error.code).toBe('FIELD_NOT_FOUND')
  })
})

describe('attaching', () => {
  it('links an existing record', async () => {
    const server = await boot()

    await request(server).post('/admin/User/u2/posts').send({ id: 'p1' }).expect(201)

    const { body } = await request(server).get('/admin/User/u2/posts').expect(200)
    expect(body.data.map((record: { id: string }) => record.id).sort()).toEqual(['p1', 'p3'])
  })

  it('rejects a body without an id', async () => {
    const server = await boot()

    for (const body of [{}, { id: null }, { id: {} }]) {
      const response = await request(server).post('/admin/User/u1/posts').send(body).expect(400)
      expect(response.body.error.code).toBe('INVALID_QUERY')
    }
  })

  it('needs update on the parent', async () => {
    const server = await boot(deny('User', 'update'))

    await request(server).post('/admin/User/u1/posts').send({ id: 'p3' }).expect(403)
  })

  it('needs update on the target, because it is the record that changes', async () => {
    // Across a one-to-many, attaching rewrites the child's foreign key. Rights
    // over the parent alone would be rights to edit records out of reach.
    const server = await boot(deny('Post', 'update'))

    await request(server).post('/admin/User/u1/posts').send({ id: 'p3' }).expect(403)
  })

  it('404s for a target record that does not exist', async () => {
    const server = await boot()

    await request(server).post('/admin/User/u1/posts').send({ id: 'nope' }).expect(404)
  })
})

describe('detaching', () => {
  it('refuses when the child cannot exist without a parent', async () => {
    // `Post.author` is required in the fixture, so there is nothing to detach
    // the post to. The database would refuse; saying so first is clearer.
    const server = await boot()

    const { body } = await request(server).delete('/admin/User/u1/posts/p1').expect(400)

    expect(body.error.code).toBe('INVALID_QUERY')
    expect(body.error.message).toMatch(/required/)
    expect(body.error.message).toMatch(/Delete the record/)
  })

  it('checks permission before the shape of the relation', async () => {
    const server = await boot(deny('User', 'update'))

    await request(server).delete('/admin/User/u1/posts/p1').expect(403)
  })
})
