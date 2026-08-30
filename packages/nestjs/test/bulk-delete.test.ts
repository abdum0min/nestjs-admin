/**
 * Deleting a selection.
 *
 * The interesting part is not the loop. It is what a partial result means, and
 * what a 200 is allowed to carry: nothing here is transactional, so a request
 * that removes twenty-eight of thirty records has to say so precisely, and it
 * has to do it without becoming a way to read the messages the exception filter
 * exists to withhold.
 */
import { ValidationError } from '@nest-admin/core'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import type { AdminHooksByModel } from '../src/hooks/contract.js'
import type { AdminResourceAuth } from '../src/auth/resource.js'
import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import { AdminModule } from '../src/module.js'
import { MAX_BULK_DELETE } from '../src/admin/service.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const users = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `u${index + 1}`,
    email: `user${index + 1}@example.com`,
    name: `User ${index + 1}`,
  }))

const boot = async (
  options: { hooks?: AdminHooksByModel; resourceAuth?: AdminResourceAuth; count?: number } = {},
) => {
  const { count = 5, ...rest } = options
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter({ User: users(count), Post: [] }),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        ...rest,
      }),
    ],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()
  return app.getHttpServer()
}

describe('deleting a selection', () => {
  it('removes every record named', async () => {
    const http = await boot()

    const { body } = await request(http)
      .delete('/admin/User')
      .send({ ids: ['u1', 'u3'] })
      .expect(200)

    expect(body.data.deleted).toEqual(['u1', 'u3'])
    expect(body.data.failed).toEqual([])

    const remaining = await request(http).get('/admin/User').expect(200)
    expect(remaining.body.data.map((r: { id: string }) => r.id)).toEqual(['u2', 'u4', 'u5'])
  })

  it('does not shadow the single-record route', async () => {
    // `DELETE /User` and `DELETE /User/u1` differ by a segment, and route
    // order in this controller has caught us before.
    const http = await boot()

    await request(http).delete('/admin/User/u1').expect(200)
    await request(http).get('/admin/User/u1').expect(404)
  })

  it('reports what survived, and why, without failing the request', async () => {
    // Twenty-eight rows being gone is not a failed request, and an error
    // response would say nothing about which ones they were.
    const http = await boot()

    const { body } = await request(http)
      .delete('/admin/User')
      .send({ ids: ['u1', 'does-not-exist', 'u2'] })
      .expect(200)

    expect(body.data.deleted).toEqual(['u1', 'u2'])
    expect(body.data.failed).toHaveLength(1)
    expect(body.data.failed[0].id).toBe('does-not-exist')
    expect(body.data.failed[0].message).toMatch(/No User record found/)
  })
})

describe('what a hook still gets to refuse', () => {
  const refusing: AdminHooksByModel = {
    User: {
      beforeDelete: ({ id }) => {
        if (id === 'u2') throw new ValidationError('User 2 is pinned.')
      },
    },
  }

  it('runs the delete hook for every record', async () => {
    // A hook that refuses a pinned record must still refuse it when the record
    // is one of forty checkboxes. A single `deleteMany` would step past all of
    // them at once, which is the opposite of what a confirmation implies.
    const http = await boot({ hooks: refusing })

    const { body } = await request(http)
      .delete('/admin/User')
      .send({ ids: ['u1', 'u2', 'u3'] })
      .expect(200)

    expect(body.data.deleted).toEqual(['u1', 'u3'])
    expect(body.data.failed).toEqual([{ id: 'u2', message: 'User 2 is pinned.' }])

    // And it is genuinely still there.
    await request(http).get('/admin/User/u2').expect(200)
  })

  it('withholds the message of a hook that broke rather than objected', async () => {
    // A 200 is not a licence to leak. The per-record message goes through the
    // same rule the exception filter applies to a whole response.
    const http = await boot({
      hooks: {
        User: {
          beforeDelete: () => {
            throw new Error('connect ECONNREFUSED 10.0.0.5:5432')
          },
        },
      },
    })

    const { body } = await request(http)
      .delete('/admin/User')
      .send({ ids: ['u1'] })
      .expect(200)

    expect(JSON.stringify(body)).not.toContain('10.0.0.5')
    expect(body.data.failed[0].message).toMatch(/internal error/i)
  })
})

describe('what it refuses outright', () => {
  it('refuses a principal who may not delete', async () => {
    const readonly: AdminResourceAuth = {
      authorize: ({ operation }) => operation !== 'delete',
    }
    const http = await boot({ resourceAuth: readonly })

    const { body } = await request(http)
      .delete('/admin/User')
      .send({ ids: ['u1', 'u2'] })
      .expect(403)

    expect(body.error.code).toBe('FORBIDDEN')
    // Refused for the operation, before a single record was touched.
    await request(http).get('/admin/User/u1').expect(200)
  })

  it('refuses a body that is not a list of ids', async () => {
    const http = await boot()

    for (const body of [{}, { ids: 'u1' }, { ids: [{}] }, { ids: [null] }]) {
      const response = await request(http).delete('/admin/User').send(body).expect(400)
      expect(response.body.error.code).toBe('INVALID_QUERY')
    }
  })

  it('refuses an empty selection', async () => {
    const http = await boot()
    const { body } = await request(http).delete('/admin/User').send({ ids: [] }).expect(400)
    expect(body.error.code).toBe('INVALID_QUERY')
  })

  it('refuses more records than the limit', async () => {
    // A blast-radius limit, not a performance one: the loop runs every hook,
    // and a request naming fifty thousand ids would be unstoppable halfway.
    const http = await boot()
    const ids = Array.from({ length: MAX_BULK_DELETE + 1 }, (_, index) => `u${index}`)

    const { body } = await request(http).delete('/admin/User').send({ ids }).expect(400)

    expect(body.error.message).toMatch(new RegExp(`limit is ${MAX_BULK_DELETE}`))
    // Nothing was deleted; the limit is checked before the loop starts.
    await request(http).get('/admin/User/u1').expect(200)
  })

  it('refuses an unknown model', async () => {
    const http = await boot()
    const { body } = await request(http)
      .delete('/admin/Nope')
      .send({ ids: ['x'] })
      .expect(404)
    expect(body.error.code).toBe('MODEL_NOT_FOUND')
  })
})
