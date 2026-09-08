/**
 * The audit trail, over HTTP.
 *
 * Three things are worth proving and the rest is bookkeeping: that the trail
 * cannot become a way to read a model the policy hid, that it never writes down
 * a value the admin would not show, and that undo refuses when the record has
 * moved since - because an undo that overwrites somebody else's later edit is
 * not an undo of anything.
 */
import type {
  AdminAuditStore,
  AuditEntry,
  AuditPage,
  AuditQuery,
  NewAuditEntry,
} from '@nest-admin/core'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import type { AdminRoles, RoleResolver } from '../src/auth/roles.js'
import { AdminModule } from '../src/module.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication | undefined

/** A store in a variable, so a test can read what was written. */
function memoryStore(): AdminAuditStore & { readonly entries: AuditEntry[] } {
  const entries: AuditEntry[] = []
  let next = 1

  return {
    entries,

    record(entry: NewAuditEntry): void {
      entries.unshift({ ...entry, id: `a${next++}` })
    },

    async list(query: AuditQuery): Promise<AuditPage> {
      const matched = entries.filter((entry) => {
        if (query.models !== undefined && !query.models.includes(entry.model)) {
          return entry.model === '*'
        }
        if (query.model !== undefined && entry.model !== query.model) return false
        if (query.action !== undefined && entry.action !== query.action) return false
        if (query.recordId !== undefined && String(entry.recordId) !== String(query.recordId)) {
          return false
        }
        if (query.since !== undefined && entry.at < query.since) return false
        return true
      })

      const perPage = query.perPage ?? 25
      const page = query.page ?? 1

      return {
        data: matched.slice((page - 1) * perPage, page * perPage),
        total: matched.length,
        page,
        perPage,
      }
    },

    async read(id: string): Promise<AuditEntry | null> {
      return entries.find((entry) => entry.id === id) ?? null
    },
  }
}

let store: ReturnType<typeof memoryStore>

beforeEach(() => {
  store = memoryStore()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

const boot = async (options: Record<string, unknown> = {}) => {
  const { audit = {}, ...rest } = options as { audit?: Record<string, unknown> }

  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter({
          User: [
            { id: 'u1', email: 'ada@example.com', name: 'Ada', active: true, role: 'ADMIN' },
            { id: 'u2', email: 'grace@example.com', name: 'Grace', active: true, role: 'USER' },
          ],
          Post: [{ id: 'p1', title: 'First', body: 'one', authorId: 'u1' }],
        }),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        audit: { store, ...audit },
        ...(rest as { adapter?: never }),
      }),
    ],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()
  return app.getHttpServer()
}

/** The trail is written without the request waiting for it. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

const entries = async (http: unknown, query = '') =>
  (
    await request(http as never)
      .get(`/admin/audit${query}`)
      .expect(200)
  ).body.data

describe('recording', () => {
  it('writes a line for a create, with the values it created', async () => {
    const http = await boot()
    await request(http).post('/admin/User').send({ email: 'new@example.com', name: 'New' })
    await settled()

    const [entry] = await entries(http)

    expect(entry.action).toBe('create')
    expect(entry.model).toBe('User')
    expect(entry.recordLabel).toBe('New')
    expect(entry.changes.map((change: { field: string }) => change.field)).toContain('email')
  })

  it('writes what changed, and only what changed', async () => {
    const http = await boot()
    await request(http)
      .patch('/admin/User/u1')
      .send({ name: 'Ada Lovelace', email: 'ada@example.com' })
    await settled()

    const [entry] = await entries(http)

    expect(entry.action).toBe('update')
    expect(entry.changes).toEqual([{ field: 'name', from: 'Ada', to: 'Ada Lovelace' }])
    expect(entry.summary).toBe('Changed name on Ada Lovelace')
  })

  /*
   * The rule that keeps the trail from becoming the one place in the product
   * where every secret is written down, kept forever, and read by a screen
   * whose whole purpose is to be browsed.
   */
  it('never records a value the admin would not show', async () => {
    const http = await boot({ models: { User: { fields: { bio: { writeOnly: true } } } } })
    await request(http).patch('/admin/User/u1').send({ bio: 'a secret', name: 'Ada L' })
    await settled()

    const [entry] = await entries(http)
    const fields = entry.changes.map((change: { field: string }) => change.field)

    expect(fields).toContain('name')
    expect(fields).not.toContain('bio')
    expect(JSON.stringify(entry)).not.toContain('a secret')
  })

  it('records a delete with the record it removed', async () => {
    const http = await boot()
    await request(http).delete('/admin/Post/p1').expect(200)
    await settled()

    const [entry] = await entries(http)
    expect(entry.action).toBe('delete')
    expect(entry.recordLabel).toBe('First')
  })

  it('records a write the policy refused', async () => {
    const http = await boot({
      roles: {
        viewer: {
          models: { User: ['metadata', 'list', 'read'] },
          capabilities: ['viewAuditLog'],
        },
      },
      roleOf: (() => 'viewer') as RoleResolver,
    })

    await request(http).patch('/admin/User/u1').send({ name: 'x' }).expect(403)
    await settled()

    const [entry] = await entries(http)
    expect(entry.action).toBe('denied')
    expect(entry.outcome).toBe('refused')
  })

  /*
   * A read is refused constantly and structurally - every metadata check on
   * every model this principal cannot see is one - so recording them would
   * bury the writes, which are what anybody opens the log to find.
   */
  it('does not record a refused read', async () => {
    const http = await boot({
      roles: {
        viewer: {
          models: { User: ['metadata', 'list', 'read'] },
          capabilities: ['viewAuditLog'],
        },
      },
      roleOf: (() => 'viewer') as RoleResolver,
    })

    await request(http).get('/admin/Post').expect(403)
    await settled()

    expect(await entries(http)).toHaveLength(0)
  })
})

describe('reading it back', () => {
  it('is refused for a role without the capability', async () => {
    const http = await boot({
      roles: { viewer: { models: { User: '*' } } },
      roleOf: (() => 'viewer') as RoleResolver,
    })

    await request(http).get('/admin/audit').expect(403)
  })

  it('is allowed for a role that was granted it', async () => {
    const http = await boot({
      roles: { auditor: { models: { User: '*' }, capabilities: ['viewAuditLog'] } },
      roleOf: (() => 'auditor') as RoleResolver,
    })

    await request(http).get('/admin/audit').expect(200)
  })

  /*
   * The whole reason the list is scoped. An entry carries the values of the
   * record it describes, so a readable log with no scope would be a way to
   * read every model in the admin regardless of the policy.
   */
  it('never shows the history of a model this role cannot read', async () => {
    const http = await boot({
      roles: { auditor: { models: { User: '*' }, capabilities: ['viewAuditLog'] } },
      roleOf: (() => 'auditor') as RoleResolver,
    })

    store.record({
      at: new Date(),
      actor: { label: 'Somebody else' },
      action: 'update',
      model: 'Post',
      recordId: 'p1',
      changes: { title: { from: 'First', to: 'Changed' } },
      outcome: 'ok',
    })

    // Post is not among this role's models, so neither is its history - and
    // asking for the entry by id is not a way around that.
    expect(await entries(http)).toHaveLength(0)
    await request(http).get('/admin/audit/a1').expect(404)
  })

  it('filters to one record, which is what a History button asks for', async () => {
    const http = await boot()
    await request(http).patch('/admin/User/u1').send({ name: 'A' })
    await request(http).patch('/admin/User/u2').send({ name: 'B' })
    await settled()

    const found = await entries(http, '?model=User&record=u1')
    expect(found).toHaveLength(1)
    expect(found[0].recordId).toBe('u1')
  })

  it('refuses an action it does not have', async () => {
    const http = await boot()
    await request(http).get('/admin/audit?action=vandalise').expect(400)
  })

  it('counts recent activity for the dashboard', async () => {
    const http = await boot()
    await request(http).patch('/admin/User/u1').send({ name: 'A' })
    await settled()

    const { body } = await request(http).get('/admin/audit/activity').expect(200)

    expect(body.data.count).toBe(1)
    expect(body.data.days).toBe(7)
    expect(body.data.recent[0].summary).toContain('Changed name')
  })
})

describe('undo', () => {
  /*
   * Found live rather than here: `updatedAt` moves on every write, so it was in
   * every entry - and an undo tried to write it back, which a value the
   * database produces refuses. Every undo on a model with a timestamp failed.
   */
  it('leaves what the database wrote itself out of the diff', async () => {
    const http = await boot()
    await request(http).patch('/admin/User/u1').send({ name: 'Ada Lovelace' })
    await settled()

    const [entry] = await entries(http)
    const fields = entry.changes.map((change: { field: string }) => change.field)

    // `createdAt` is generated on the test model, and never a person's change.
    expect(fields).toEqual(['name'])
  })

  it('puts the old values back', async () => {
    const http = await boot()
    await request(http).patch('/admin/User/u1').send({ name: 'Ada Lovelace' }).expect(200)
    await settled()

    const [entry] = await entries(http)
    await request(http).post(`/admin/audit/${entry.id}/undo`).expect(201)

    const { body } = await request(http).get('/admin/User/u1').expect(200)
    expect(body.data.name).toBe('Ada')
  })

  it('is itself recorded, and says what it reversed', async () => {
    const http = await boot()
    await request(http).patch('/admin/User/u1').send({ name: 'Ada Lovelace' })
    await settled()

    const [update] = await entries(http)
    await request(http).post(`/admin/audit/${update.id}/undo`).expect(201)
    await settled()

    const [undo] = await entries(http)
    expect(undo.action).toBe('undo')
    expect(undo.undoOf).toBe(update.id)
    expect(undo.changes).toEqual([{ field: 'name', from: 'Ada Lovelace', to: 'Ada' }])
  })

  /*
   * The check that makes undo safe. Writing the old values over somebody
   * else's later edit is not an undo - it is a silent third edit that discards
   * their work and reports success.
   */
  it('refuses when the record has moved since', async () => {
    const http = await boot()
    await request(http).patch('/admin/User/u1').send({ name: 'Ada Lovelace' })
    await settled()

    const [entry] = await entries(http)
    await request(http).patch('/admin/User/u1').send({ name: 'Somebody else' }).expect(200)

    const refused = await request(http).post(`/admin/audit/${entry.id}/undo`).expect(400)
    expect(refused.body.error.message).toContain('has changed since')

    const { body } = await request(http).get('/admin/User/u1').expect(200)
    expect(body.data.name).toBe('Somebody else')
  })

  it('undoes a create by removing what it created', async () => {
    const http = await boot()
    const created = await request(http)
      .post('/admin/User')
      .send({ email: 'new@example.com', name: 'New' })
      .expect(201)
    await settled()

    const [entry] = await entries(http)
    await request(http).post(`/admin/audit/${entry.id}/undo`).expect(201)

    await request(http).get(`/admin/User/${created.body.data.id}`).expect(404)
  })

  it('undoes a soft delete, which is a restore', async () => {
    const http = await boot({ models: { Post: { softDelete: 'deletedAt' } } })
    await request(http).delete('/admin/Post/p1').expect(200)
    await settled()

    const [entry] = await entries(http)
    expect(entry.undoable).toBe(true)

    await request(http).post(`/admin/audit/${entry.id}/undo`).expect(201)

    const { body } = await request(http).get('/admin/Post?perPage=10').expect(200)
    expect(body.data).toHaveLength(1)
  })

  it('refuses to undo a hard delete that kept nothing, and says why', async () => {
    const http = await boot()
    await request(http).delete('/admin/Post/p1').expect(200)
    await settled()

    const [entry] = await entries(http)
    expect(entry.undoable).toBe(false)
    expect(entry.undoableReason).toContain('keepDeleted')

    const refused = await request(http).post(`/admin/audit/${entry.id}/undo`).expect(400)
    expect(refused.body.error.message).toContain('keepDeleted')
  })

  it('needs the write permission on the model, not a privilege of its own', async () => {
    const roles: AdminRoles = {
      auditor: { models: { User: ['metadata', 'list', 'read'] }, capabilities: ['viewAuditLog'] },
    }
    const http = await boot({ roles, roleOf: (() => 'auditor') as RoleResolver })

    // Written directly, because this role cannot make the change that would
    // have produced it - which is the whole point of the test.
    store.record({
      at: new Date(),
      actor: { label: 'Somebody else' },
      action: 'update',
      model: 'User',
      recordId: 'u1',
      changes: { name: { from: 'Ada Lovelace', to: 'Ada' } },
      outcome: 'ok',
    })

    const [entry] = await entries(http)
    await request(http).post(`/admin/audit/${entry.id}/undo`).expect(403)
  })
})

describe('an admin with no store', () => {
  it('says so rather than pretending, and offers no capability', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AdminModule.forRoot({
          adapter: new InMemoryAdapter({ User: [], Post: [] }),
          auth: unsafeAllowAllRequests(),
          uiRoot: BUILT_UI_ROOT,
        }),
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()
    const http = app.getHttpServer()

    const { body } = await request(http).get('/admin/meta').expect(200)
    expect(body.data.capabilities.viewAuditLog).toBe(false)

    await request(http).get('/admin/audit').expect(400)
  })
})
