/**
 * Two people editing one record.
 *
 * The failure this exists for is not exotic and produces no error: Anna opens a
 * post and changes the title; Bora, who opened the same post a minute earlier,
 * changes only the summary and saves. His form carries every field, including
 * the title as it was when he opened it, so Anna's change is gone. Neither of
 * them is told anything.
 *
 * That is fine while an admin has one administrator. The release before this one
 * added roles, which is what stops it being true.
 *
 * The first test below reproduces the loss with the guard off, so what the rest
 * of the file prevents is on the record rather than described.
 */
import {
  RecordNotFoundError,
  type FieldMetadata,
  type ModelMetadata,
  type OrmAdapter,
  type Page,
  type RecordData,
  type RecordId,
} from '@nest-admin/core'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import { AdminModule } from '../src/module.js'
import { BUILT_UI_ROOT } from './app.js'
import { Test } from '@nestjs/testing'

/**
 * A adapter of its own rather than the shared in-memory one.
 *
 * The shared fixture validates writes against a module-level model list, so a
 * subclass cannot add the column this whole file is about. Two models, six
 * methods, and `users` stamps itself on every write - which is what a schema
 * with `@updatedAt` does and what makes the version move.
 */
class VersionedAdapter implements OrmAdapter {
  readonly name = 'versioned'
  rows: Record<string, RecordData[]> = {
    User: [
      {
        id: 'u1',
        name: 'Ada',
        bio: 'first',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    // No column recording a change, so nothing here can be protected - which
    // is the case the startup warning is about.
    Post: [{ id: 'p1', title: 'One' }],
  }

  async getModels(): Promise<readonly ModelMetadata[]> {
    const text = (name: string, extra: Partial<FieldMetadata> = {}): FieldMetadata => ({
      name,
      kind: 'string',
      isId: false,
      isRequired: false,
      isUnique: false,
      isList: false,
      isGenerated: false,
      ...extra,
    })

    return [
      {
        name: 'User',
        primaryKey: ['id'],
        fields: [
          text('id', { isId: true, isGenerated: true }),
          text('name'),
          text('bio'),
          text('updatedAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
        ],
      },
      {
        name: 'Post',
        primaryKey: ['id'],
        fields: [text('id', { isId: true, isGenerated: true }), text('title')],
      },
    ]
  }

  async list(model: string): Promise<Page<RecordData>> {
    const data = this.rows[model] ?? []
    return { data: [...data], total: data.length, page: 1, perPage: 25 }
  }

  async findOne(model: string, id: RecordId): Promise<RecordData | null> {
    return (this.rows[model] ?? []).find((row) => String(row['id']) === String(id)) ?? null
  }

  async create(model: string, data: RecordData): Promise<RecordData> {
    const created = { ...data }
    ;(this.rows[model] ??= []).push(created)
    return created
  }

  async update(model: string, id: RecordId, data: RecordData): Promise<RecordData> {
    const rows = this.rows[model] ?? []
    const index = rows.findIndex((row) => String(row['id']) === String(id))
    if (index < 0) throw new RecordNotFoundError(model, id)

    // What `@updatedAt` does, and what makes the version move.
    const stamped = model === 'User' ? { updatedAt: new Date().toISOString() } : {}
    const updated = { ...rows[index], ...data, ...stamped }
    rows[index] = updated
    return updated
  }

  async delete(): Promise<void> {}
  async listRelated(): Promise<Page<RecordData>> {
    return { data: [], total: 0, page: 1, perPage: 25 }
  }
  async attachRelated(): Promise<void> {}
  async detachRelated(): Promise<void> {}
}

const seeded = () => new VersionedAdapter()

const apps: INestApplication[] = []

async function appWith(concurrency?: 'optimistic' | 'last-write-wins') {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: seeded(),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        ...(concurrency ? { concurrency } : {}),
      }),
    ],
  }).compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  apps.push(app)
  return app
}

const http = (app: INestApplication) => request(app.getHttpServer())

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
})

/** What both people are holding when they open the form. */
async function open(
  app: INestApplication,
): Promise<{ record: Record<string, unknown>; version: string }> {
  const { body } = await http(app).get('/admin/User/u1').expect(200)
  return { record: body.data, version: String(body.data.updatedAt) }
}

describe('without the guard', () => {
  it('loses the first change, and tells nobody', async () => {
    const app = await appWith()

    // Both open the record. Bora's copy still has the original name.
    const anna = await open(app)
    const bora = await open(app)

    await http(app)
      .patch('/admin/User/u1')
      .send({ name: 'Renamed by Anna', bio: anna.record['bio'] })
      .expect(200)

    // Bora changes only the bio - but his form carries the name he opened with.
    await http(app)
      .patch('/admin/User/u1')
      .send({ name: bora.record['name'], bio: 'Rewritten by Bora' })
      .expect(200)

    const { body } = await http(app).get('/admin/User/u1').expect(200)
    expect(body.data.name).toBe('Ada')
    expect(body.data.bio).toBe('Rewritten by Bora')
  })
})

describe('with the guard', () => {
  it('refuses the second write and applies none of it', async () => {
    const app = await appWith('optimistic')

    const anna = await open(app)
    const bora = await open(app)

    await http(app)
      .patch('/admin/User/u1')
      .set('x-admin-version', anna.version)
      .send({ name: 'Renamed by Anna' })
      .expect(200)

    const refused = await http(app)
      .patch('/admin/User/u1')
      .set('x-admin-version', bora.version)
      .send({ name: bora.record['name'], bio: 'Rewritten by Bora' })
      .expect(409)

    expect(refused.body.error.code).toBe('CONFLICT')

    // Anna's change survived, and Bora's was applied nowhere - not even the
    // field he actually meant to change.
    const { body } = await http(app).get('/admin/User/u1').expect(200)
    expect(body.data.name).toBe('Renamed by Anna')
    expect(body.data.bio).toBe('first')
  })

  it('lets the second write through once it is based on the new version', async () => {
    // The recovery: re-read, then save. Nothing is locked and nobody waits.
    const app = await appWith('optimistic')

    const first = await open(app)
    await http(app)
      .patch('/admin/User/u1')
      .set('x-admin-version', first.version)
      .send({ name: 'Renamed by Anna' })
      .expect(200)

    const reread = await open(app)
    await http(app)
      .patch('/admin/User/u1')
      .set('x-admin-version', reread.version)
      .send({ bio: 'Rewritten by Bora' })
      .expect(200)

    const { body } = await http(app).get('/admin/User/u1').expect(200)
    expect(body.data).toMatchObject({ name: 'Renamed by Anna', bio: 'Rewritten by Bora' })
  })

  it('accepts a write that carries the current version', async () => {
    const app = await appWith('optimistic')
    const { version } = await open(app)

    await http(app)
      .patch('/admin/User/u1')
      .set('x-admin-version', version)
      .send({ name: 'Fine' })
      .expect(200)
  })

  it('does not mind how the timestamp was formatted', async () => {
    // The value makes a round trip through JSON, so what comes back is a string
    // where the stored one is a Date. Comparing them raw would refuse every
    // write.
    const app = await appWith('optimistic')
    const { version } = await open(app)

    await http(app)
      .patch('/admin/User/u1')
      .set('x-admin-version', new Date(version).toUTCString())
      .send({ name: 'Also fine' })
      .expect(200)
  })

  it('allows a caller that sends no version at all', async () => {
    // A script patching one field is not the collision this exists for, and
    // refusing it would break every non-browser caller the moment the option
    // is turned on.
    const app = await appWith('optimistic')
    await http(app).patch('/admin/User/u1').send({ name: 'From a script' }).expect(200)
  })

  it('does nothing for a model with no column recording a change', async () => {
    // `Post` has none. The write goes through, and the startup warning is what
    // tells the developer this model is unprotected.
    const app = await appWith('optimistic')

    await http(app)
      .patch('/admin/Post/p1')
      .set('x-admin-version', '2020-01-01T00:00:00.000Z')
      .send({ title: 'Two' })
      .expect(200)
  })
})

describe('the default', () => {
  it('ignores the header entirely', async () => {
    // Turning the option on can refuse a write that succeeds today, so it is
    // opt-in: an admin that configures nothing behaves exactly as it did.
    const app = await appWith()

    await http(app)
      .patch('/admin/User/u1')
      .set('x-admin-version', '1999-01-01T00:00:00.000Z')
      .send({ name: 'Still fine' })
      .expect(200)
  })
})
