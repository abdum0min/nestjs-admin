/**
 * Deleting a record by marking it.
 *
 * This is closer to a defect being fixed than to a feature being added. A
 * schema with a `deletedAt` column has already decided that its rows are kept;
 * until now the admin listed marked rows as live and its Delete button
 * destroyed what the schema had arranged to preserve. Both halves are asserted
 * here, and so is the line between them - `permanent` really does remove.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import { AdminModule } from '../src/module.js'
import { createAdminApp } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const seed = () => ({
  User: [{ id: 'u1', email: 'ada@example.com', name: 'Ada', active: true, role: 'ADMIN' }],
  Post: [
    { id: 'p1', title: 'First', body: 'A body', authorId: 'u1', deletedAt: null },
    { id: 'p2', title: 'Second', body: 'Another', authorId: 'u1', deletedAt: null },
  ],
})

const SOFT = { Post: { softDelete: 'deletedAt' } } as const

const boot = async (models: Record<string, unknown> = SOFT) => {
  app = await createAdminApp(
    new InMemoryAdapter(seed()),
    undefined,
    undefined,
    undefined,
    undefined,
    models as never,
  )
  return app.getHttpServer()
}

const titles = (body: { data: readonly { title: string }[] }) => body.data.map((row) => row.title)

describe('deleting', () => {
  it('marks the record instead of removing it', async () => {
    const server = await boot()

    await request(server).delete('/admin/Post/p1').expect(200)

    // Still there - which is the whole point, and the thing the old behaviour
    // made impossible to check afterwards.
    const { body } = await request(server).get('/admin/Post/p1').expect(200)
    expect(body.data.deletedAt).not.toBeNull()
  })

  it('takes it out of the list', async () => {
    const server = await boot()
    await request(server).delete('/admin/Post/p1').expect(200)

    const { body } = await request(server).get('/admin/Post').expect(200)
    expect(titles(body)).toEqual(['Second'])
    expect(body.meta.total).toBe(1)
  })

  it('leaves the row alone on a model that did not ask for this', async () => {
    // The behaviour every existing installation has. A model without the
    // option must be untouched by the option existing.
    const server = await boot({})

    await request(server).delete('/admin/Post/p1').expect(200)
    await request(server).get('/admin/Post/p1').expect(404)
  })

  it('runs the delete hooks, because from everywhere else this is a delete', async () => {
    const seen: string[] = []
    app = await createAdminApp(
      new InMemoryAdapter(seed()),
      undefined,
      undefined,
      undefined,
      undefined,
      SOFT as never,
      undefined,
      {
        Post: {
          beforeDelete: ({ id }) => {
            seen.push(`before:${String(id)}`)
          },
          afterDelete: ({ id }) => {
            seen.push(`after:${String(id)}`)
          },
        },
      },
    )

    await request(app.getHttpServer()).delete('/admin/Post/p1').expect(200)
    // A `beforeDelete` that refuses to release a record with unpaid invoices
    // has exactly the same reason to refuse when the row is only being marked.
    expect(seen).toEqual(['before:p1', 'after:p1'])
  })
})

describe('seeing what was deleted', () => {
  it('shows only the marked records', async () => {
    const server = await boot()
    await request(server).delete('/admin/Post/p1').expect(200)

    const { body } = await request(server).get('/admin/Post?deleted=deleted').expect(200)
    expect(titles(body)).toEqual(['First'])
  })

  it('shows both', async () => {
    const server = await boot()
    await request(server).delete('/admin/Post/p1').expect(200)

    const { body } = await request(server).get('/admin/Post?deleted=all').expect(200)
    expect(titles(body)).toEqual(['First', 'Second'])
  })

  it('treats an absent parameter as the live records', async () => {
    const server = await boot()
    await request(server).delete('/admin/Post/p1').expect(200)

    const { body } = await request(server).get('/admin/Post?deleted=live').expect(200)
    expect(titles(body)).toEqual(['Second'])
  })

  it('refuses the parameter on a model that has no deleted records', async () => {
    // Ignoring it would answer a request for the deleted records with the live
    // ones: the wrong rows, reported as success.
    const server = await boot({})
    const { body } = await request(server).get('/admin/Post?deleted=deleted').expect(400)
    expect(body.error.message).toMatch(/does not use soft delete/)
  })

  it('refuses a value it does not understand', async () => {
    const server = await boot()
    const { body } = await request(server).get('/admin/Post?deleted=yes').expect(400)
    expect(body.error.message).toMatch(/live, deleted, or all/)
  })
})

describe('restoring', () => {
  it('brings the record back into the list', async () => {
    const server = await boot()
    await request(server).delete('/admin/Post/p1').expect(200)

    const { body } = await request(server).post('/admin/restore/Post/p1').expect(201)
    expect(body.data.deletedAt).toBeNull()

    const list = await request(server).get('/admin/Post').expect(200)
    expect(titles(list.body)).toEqual(['First', 'Second'])
  })

  it('refuses on a model whose deleted records are gone', async () => {
    const server = await boot({})
    const { body } = await request(server).post('/admin/restore/Post/p1').expect(400)
    expect(body.error.message).toMatch(/nothing to restore/)
  })

  it('is not read as a relation named "restore"', async () => {
    // Declared under a reserved first segment for this reason. As
    // `/:model/:id/restore` it would be indistinguishable from attaching to a
    // relation, and resolved by declaration order rather than by intent.
    const server = await boot()
    await request(server).post('/admin/restore/Post/p1').expect(201)
  })
})

describe('deleting for good', () => {
  it('removes the row when the caller asks', async () => {
    const server = await boot()

    await request(server).delete('/admin/Post/p1?permanent=true').expect(200)
    await request(server).get('/admin/Post/p1').expect(404)
  })

  it('does not remove it without asking', async () => {
    const server = await boot()

    await request(server).delete('/admin/Post/p1?permanent=false').expect(200)
    await request(server).get('/admin/Post/p1').expect(200)
  })

  it('empties a selection when asked', async () => {
    const server = await boot()

    await request(server)
      .delete('/admin/Post?permanent=true')
      .send({ ids: ['p1', 'p2'] })
      .expect(200)

    const { body } = await request(server).get('/admin/Post?deleted=all').expect(200)
    expect(body.data).toEqual([])
  })

  it('marks a selection otherwise', async () => {
    const server = await boot()

    await request(server)
      .delete('/admin/Post')
      .send({ ids: ['p1', 'p2'] })
      .expect(200)

    const live = await request(server).get('/admin/Post').expect(200)
    const all = await request(server).get('/admin/Post?deleted=all').expect(200)
    expect(live.body.data).toEqual([])
    expect(all.body.data).toHaveLength(2)
  })
})

describe('the column itself', () => {
  it('is named in the metadata, so the interface knows deleting can be undone', async () => {
    const server = await boot()
    const { body } = await request(server).get('/admin/meta').expect(200)

    const post = body.data.models.find((model: { name: string }) => model.name === 'Post')
    const user = body.data.models.find((model: { name: string }) => model.name === 'User')
    expect(post.softDeleteField).toBe('deletedAt')
    expect(user.softDeleteField).toBeUndefined()
  })

  it('is refused in a write', async () => {
    // Writable, it would be a delete and a restore reachable from an ordinary
    // form, with no confirmation and no record of which one happened.
    const server = await boot()
    const { body } = await request(server)
      .patch('/admin/Post/p1')
      .send({ deletedAt: new Date().toISOString() })
      .expect(400)

    expect(body.error.message).toMatch(/deletedAt/)
  })

  it('is read-only in the metadata, so no form offers it', async () => {
    const server = await boot()
    const { body } = await request(server).get('/admin/meta').expect(200)

    const post = body.data.models.find((model: { name: string }) => model.name === 'Post')
    const column = post.fields.find((field: { name: string }) => field.name === 'deletedAt')
    expect(column.readOnly).toBe(true)
  })
})

describe('deleted children', () => {
  it('are hidden from the parent that owns them', async () => {
    // The least obvious place for a marked record to survive, and the one that
    // would undo the delete everywhere it mattered.
    const server = await boot()
    await request(server).delete('/admin/Post/p1').expect(200)

    const { body } = await request(server).get('/admin/User/u1/posts').expect(200)
    expect(titles(body)).toEqual(['Second'])
  })
})

describe('a column that cannot carry it', () => {
  const bootWith = async (models: Record<string, unknown>) => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AdminModule.forRoot({
          adapter: new InMemoryAdapter(seed()),
          auth: unsafeAllowAllRequests(),
          models: models as never,
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  }

  it('fails at startup rather than at the first delete', async () => {
    await expect(bootWith({ Post: { softDelete: 'title' } })).rejects.toThrow(/Post\.title/)
  })

  it('says what a usable column looks like', async () => {
    await expect(bootWith({ Post: { softDelete: 'title' } })).rejects.toThrow(
      /deletedAt DateTime\?/,
    )
  })

  it('accepts an optional date column', async () => {
    await expect(bootWith(SOFT as never)).resolves.toBeUndefined()
  })
})
