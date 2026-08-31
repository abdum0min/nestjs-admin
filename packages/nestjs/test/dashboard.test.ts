/**
 * The dashboard document, over real HTTP.
 *
 * Two things are being proven, and only one of them is about drawing anything.
 *
 * The first is that a dashboard cannot be used to read what a principal is not
 * allowed to read. A widget names a model, so it can be authorized, and the
 * check happens before any query runs - a count of a hidden table must not
 * merely be omitted from the page, it must never be asked for.
 *
 * The second is that one broken widget is one broken widget. A dashboard is
 * several independent questions on one page; `stat` runs application code, and
 * application code throws.
 */
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import type { AdminResourceAuth } from '../src/auth/resource.js'
import type { AdminDashboard } from '../src/dashboard/contract.js'
import { createAdminApp } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

const DAY = 86_400_000

/** An ISO timestamp `days` ago. Rows are dated so the chart has something to bucket. */
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const USERS = [
  { id: 'u1', email: 'ada@example.com', name: 'Ada', active: true, createdAt: ago(1) },
  { id: 'u2', email: 'bob@example.com', name: 'Bob', active: false, createdAt: ago(2) },
  { id: 'u3', email: 'cy@example.com', name: 'Cy', active: true, createdAt: ago(40) },
]

const POSTS = [{ id: 'p1', title: 'First', published: true, authorId: 'u1' }]

const seeded = () => new InMemoryAdapter({ User: USERS, Post: POSTS })

const apps: INestApplication[] = []

async function appWith(
  dashboard?: AdminDashboard,
  resourceAuth?: AdminResourceAuth,
  adapter = seeded(),
): Promise<INestApplication> {
  const app = await createAdminApp(
    adapter,
    unsafeAllowAllRequests(),
    resourceAuth,
    undefined,
    undefined,
    undefined,
    dashboard,
  )
  apps.push(app)
  return app
}

const get = async (app: INestApplication) =>
  request(app.getHttpServer()).get('/admin/dashboard').expect(200)

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
})

describe('the generated dashboard', () => {
  it('builds one from the schema when nothing is declared', async () => {
    const { body } = await get(await appWith())

    expect(body.success).toBe(true)
    expect(body.data.generated).toBe(true)

    // A count per model, so someone who configured nothing still lands on
    // something that says how much data there is.
    const counts = body.data.widgets.filter((w: { kind: string }) => w.kind === 'count')
    expect(counts.map((w: { model: string }) => w.model)).toEqual(['User', 'Post'])
    expect(counts[0].data).toMatchObject({ value: 3 })
  })

  it('charts and lists only models that record when a row was created', async () => {
    const { body } = await get(await appWith())

    // `User` has `createdAt`; `Post` in the test schema does not. Offering a
    // "recent Posts" list with no idea which are recent would be a widget that
    // is confidently wrong.
    const dated = body.data.widgets
      .filter((w: { kind: string }) => w.kind === 'chart' || w.kind === 'list')
      .map((w: { model: string }) => w.model)

    expect(dated.length).toBeGreaterThan(0)
    expect(new Set(dated)).toEqual(new Set(['User']))
  })

  it('names a model the way the admin names it everywhere else', async () => {
    // The sidebar says "People" because the application labelled it so. A
    // dashboard that says "User" beside it reads as a different thing.
    const app = await createAdminApp(
      seeded(),
      unsafeAllowAllRequests(),
      undefined,
      undefined,
      undefined,
      { User: { label: 'People' } },
    )
    apps.push(app)

    const { body } = await get(app)
    const titles = body.data.widgets.map((w: { title: string }) => w.title)

    expect(titles).toContain('People')
    expect(titles).toContain('Recent People')
    expect(titles).not.toContain('User')
  })

  it('says it was generated, so the interface can offer to replace it', async () => {
    const declared = await get(await appWith([{ kind: 'count', title: 'Users', model: 'User' }]))
    expect(declared.body.data.generated).toBe(false)
  })
})

describe('a declared dashboard', () => {
  it('replaces the generated one entirely', async () => {
    const { body } = await get(
      await appWith([
        { kind: 'count', title: 'Active users', model: 'User', filter: 'active:eq:true' },
      ]),
    )

    expect(body.data.widgets).toHaveLength(1)
    expect(body.data.widgets[0]).toMatchObject({
      kind: 'count',
      title: 'Active users',
      model: 'User',
      // Carried through so the interface can link the number to the same rows.
      filter: 'active:eq:true',
      data: { value: 2 },
    })
  })

  it('gives each kind a sensible width without being told', async () => {
    const { body } = await get(
      await appWith([
        { kind: 'count', title: 'Users', model: 'User' },
        { kind: 'chart', title: 'Signups', model: 'User' },
        { kind: 'list', title: 'Newest', model: 'User' },
        { kind: 'count', title: 'Wide', model: 'User', span: 4 },
      ]),
    )

    expect(body.data.widgets.map((w: { span: number }) => w.span)).toEqual([1, 2, 2, 4])
  })

  it('returns the newest records first for a list', async () => {
    const { body } = await get(await appWith([{ kind: 'list', title: 'Newest', model: 'User' }]))

    expect(body.data.widgets[0].data.records.map((r: { label: string }) => r.label)).toEqual([
      'Ada',
      'Bob',
      'Cy',
    ])
    expect(body.data.widgets[0].data.total).toBe(3)
  })

  it('buckets a chart by day and totals the period', async () => {
    const { body } = await get(
      await appWith([{ kind: 'chart', title: 'Signups', model: 'User', buckets: 7 }]),
    )

    const data = body.data.widgets[0].data
    expect(data.points).toHaveLength(7)
    // Two users in the last week; the third is forty days old and outside it.
    expect(data.total).toBe(2)
  })

  it('runs application code for a stat and passes the value through', async () => {
    const { body } = await get(
      await appWith([
        {
          kind: 'stat',
          title: 'Revenue',
          load: () => ({ value: '$12,400', delta: 8, hint: 'vs last month' }),
        },
      ]),
    )

    expect(body.data.widgets[0]).toMatchObject({
      kind: 'stat',
      data: { value: '$12,400', delta: 8, hint: 'vs last month' },
    })
    // No model, by design - the number may come from anywhere.
    expect(body.data.widgets[0].model).toBeUndefined()
  })

  it('compares against an earlier period when asked to', async () => {
    const { body } = await get(
      await appWith([{ kind: 'count', title: 'Users', model: 'User', compareDays: 7 }]),
    )

    // Three in total, two of them in the last week, so one existed before.
    expect(body.data.widgets[0].data).toMatchObject({ value: 3, delta: 200 })
    expect(body.data.widgets[0].data.hint).toContain('2 in the last 7 days')
  })
})

describe('authorization', () => {
  it('drops a widget over a model this principal cannot list', async () => {
    const { body } = await get(
      await appWith(
        [
          { kind: 'count', title: 'Users', model: 'User' },
          { kind: 'count', title: 'Posts', model: 'Post' },
        ],
        { authorize: ({ model }) => model !== 'Post' },
      ),
    )

    expect(body.data.widgets.map((w: { title: string }) => w.title)).toEqual(['Users'])
  })

  it('never queries the model it dropped', async () => {
    const adapter = seeded()
    const list = vi.spyOn(adapter, 'list')

    await get(
      await appWith(
        [{ kind: 'count', title: 'Posts', model: 'Post' }],
        { authorize: ({ model }) => model !== 'Post' },
        adapter,
      ),
    )

    // Not "returned nothing" - never asked. A dashboard is not a side channel
    // onto a table someone is not allowed to open.
    expect(list.mock.calls.some(([model]) => model === 'Post')).toBe(false)
  })

  it('keeps a stat, which names no model and is the application own code', async () => {
    const { body } = await get(
      await appWith([{ kind: 'stat', title: 'Revenue', load: () => ({ value: 1 }) }], {
        authorize: () => false,
      }),
    )

    expect(body.data.widgets.map((w: { title: string }) => w.title)).toEqual(['Revenue'])
  })
})

describe('failure', () => {
  it('marks the widget that failed and sends the rest of the page', async () => {
    const { body } = await get(
      await appWith([
        { kind: 'count', title: 'Users', model: 'User' },
        {
          kind: 'stat',
          title: 'Revenue',
          load: () => {
            throw new Error('the payment processor is down')
          },
        },
        { kind: 'count', title: 'Posts', model: 'Post' },
      ]),
    )

    const [users, revenue, posts] = body.data.widgets
    expect(users.data).toMatchObject({ value: 3 })
    expect(revenue).toMatchObject({ title: 'Revenue', failed: true })
    expect(posts.data).toMatchObject({ value: 1 })
  })

  it('never forwards the cause, which came from application code', async () => {
    const { body } = await get(
      await appWith([
        {
          kind: 'stat',
          title: 'Revenue',
          load: () => {
            throw new Error('postgres://user:hunter2@db.internal:5432 refused')
          },
        },
      ]),
    )

    expect(JSON.stringify(body)).not.toContain('hunter2')
    expect(body.data.widgets[0].data).toBeUndefined()
  })

  it('fails one widget when a filter is not field:operator:value', async () => {
    const { body } = await get(
      await appWith([{ kind: 'count', title: 'Users', model: 'User', filter: 'active' }]),
    )

    expect(body.data.widgets[0].failed).toBe(true)
  })

  it('refuses to chart a model with no creation timestamp', async () => {
    const { body } = await get(await appWith([{ kind: 'chart', title: 'Posts', model: 'Post' }]))

    // Better than a chart of nothing under a title that promises otherwise.
    expect(body.data.widgets[0].failed).toBe(true)
  })
})

describe('routing', () => {
  it('is reached before the record route, so `dashboard` is not read as an id', async () => {
    // `GET /admin/:model/:id` would match `/admin/dashboard` if it were declared
    // first - the dashboard would become a request for a record called
    // "dashboard" of a model called "admin".
    const { body } = await get(await appWith())
    expect(body.data.widgets).toBeDefined()
  })
})
