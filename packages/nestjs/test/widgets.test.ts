/**
 * The widgets 0.19.0 added, over real HTTP.
 *
 * Two of them are new kinds and the rest is emphasis. What is worth asserting
 * is the part that is not about drawing:
 *
 * - a `breakdown` refuses a column with no fixed set of values, rather than
 *   issuing a query per distinct row
 * - it is authorized exactly as every other widget is
 * - a value with no records behind it is kept, because "none are admins" is a
 *   statement
 * - a `list` widget's columns are checked against the model
 *
 * Against `User`, because the shared fixture owns the models and that is the
 * one carrying an enum, a boolean and a number. Its enum values are categories
 * rather than states, so every tone below is `neutral` - and that is the right
 * thing to assert here. Whether `FAILED` is red is a question about the word
 * list, which is unit-tested in core; this file is about whether a tone reaches
 * the document at all.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import type { AdminResourceAuth } from '../src/auth/resource.js'
import type { AdminDashboard } from '../src/dashboard/contract.js'
import { AdminModule } from '../src/module.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

const USERS = [
  { id: 'u1', email: 'ada@example.com', name: 'Ada', role: 'ADMIN', active: true, age: 41 },
  { id: 'u2', email: 'bob@example.com', name: 'Bob', role: 'USER', active: true, age: 28 },
  { id: 'u3', email: 'cy@example.com', name: 'Cy', role: 'USER', active: false, age: 35 },
]

const apps: INestApplication[] = []

async function appWith(
  dashboard: AdminDashboard,
  resourceAuth?: AdminResourceAuth,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter({ User: USERS }),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        dashboard,
        ...(resourceAuth === undefined ? {} : { resourceAuth }),
      }),
    ],
  }).compile()

  const app = moduleRef.createNestApplication()
  apps.push(app)
  await app.init()
  return app
}

const widgets = async (app: INestApplication) =>
  (await request(app.getHttpServer()).get('/admin/dashboard').expect(200)).body.data.widgets

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
})

describe('a breakdown', () => {
  it('divides an enum into one slice per value', async () => {
    const app = await appWith([
      { kind: 'breakdown', title: 'By role', model: 'User', field: 'role' },
    ])

    const [widget] = await widgets(app)

    expect(widget.data.total).toBe(3)
    expect(widget.data.field).toBe('role')
    expect(widget.data.slices).toEqual([
      { value: 'USER', label: 'USER', count: 2, tone: 'neutral' },
      { value: 'ADMIN', label: 'ADMIN', count: 1, tone: 'neutral' },
    ])
  })

  /*
   * A value nobody has is still a value. "None are admins" is a different
   * statement from not mentioning admins at all, and dropping the zero makes
   * the second look like the first.
   */
  it('keeps a value with no records behind it', async () => {
    const app = await appWith([
      {
        kind: 'breakdown',
        title: 'By role',
        model: 'User',
        field: 'role',
        filter: 'active:eq:false',
      },
    ])

    const slices = (await widgets(app))[0].data.slices
    expect(slices).toHaveLength(2)
    expect(slices.find((slice: { value: string }) => slice.value === 'ADMIN').count).toBe(0)
  })

  it('divides a boolean into Yes and No, with no tone', async () => {
    const app = await appWith([
      { kind: 'breakdown', title: 'Active?', model: 'User', field: 'active' },
    ])

    const [widget] = await widgets(app)

    // `true` is not success. A boolean is a fact, not a state that went well.
    expect(widget.data.slices).toEqual([
      { value: 'true', label: 'Yes', count: 2 },
      { value: 'false', label: 'No', count: 1 },
    ])
  })

  it('draws no tones where the application said the values are categories', async () => {
    const app = await appWith([
      { kind: 'breakdown', title: 'By role', model: 'User', field: 'role', tones: false },
    ])

    const [widget] = await widgets(app)
    expect(widget.data.slices.every((slice: { tone?: string }) => slice.tone === undefined)).toBe(
      true,
    )
  })

  /*
   * The constraint that makes this viable rather than a compromise. The counts
   * are one query per value; a column whose values are not known in advance has
   * no bounded number of them, so the same code over a free text column would
   * be a query per distinct address.
   */
  it('refuses a column with no fixed set of values', async () => {
    const app = await appWith([
      { kind: 'breakdown', title: 'By email', model: 'User', field: 'email' },
    ])

    const [widget] = await widgets(app)
    expect(widget.failed).toBe(true)
    expect(widget.data).toBeUndefined()
  })

  it('says so when the column does not exist', async () => {
    const app = await appWith([
      { kind: 'breakdown', title: 'By nothing', model: 'User', field: 'nope' },
    ])

    expect((await widgets(app))[0].failed).toBe(true)
  })

  /*
   * A widget is authorized before it is queried, and a new kind must not be a
   * hole in that. This one names a model, so the same rule applies to it.
   */
  it('is dropped for a principal who cannot list the model', async () => {
    const app = await appWith(
      [{ kind: 'breakdown', title: 'By role', model: 'User', field: 'role' }],
      { authorize: () => false },
    )

    expect(await widgets(app)).toEqual([])
  })
})

describe('a progress widget', () => {
  it('counts a model against a target', async () => {
    const app = await appWith([
      {
        kind: 'progress',
        title: 'Active people',
        model: 'User',
        filter: 'active:eq:true',
        target: 10,
        hint: 'this week',
      },
    ])

    const [widget] = await widgets(app)
    expect(widget.data).toEqual({ value: 2, target: 10, hint: 'this week' })
  })

  it('takes a number the application worked out for itself', async () => {
    const app = await appWith([
      {
        kind: 'progress',
        title: 'Revenue',
        load: () => ({ value: 7_500, target: 10_000, hint: 'to the quarter goal' }),
      },
    ])

    const [widget] = await widgets(app)
    expect(widget.data).toMatchObject({ value: 7_500, target: 10_000 })
  })

  it('fails visibly when it has neither', async () => {
    const app = await appWith([{ kind: 'progress', title: 'Nothing' }])
    expect((await widgets(app))[0].failed).toBe(true)
  })
})

describe('emphasis', () => {
  it('carries the accent, icon and footer the application chose', async () => {
    const app = await appWith([
      {
        kind: 'count',
        title: 'People',
        model: 'User',
        color: 'warning',
        icon: 'receipt',
        href: 'https://example.com/reports',
        hrefLabel: 'Full report',
      },
    ])

    expect((await widgets(app))[0]).toMatchObject({
      color: 'warning',
      icon: 'receipt',
      href: 'https://example.com/reports',
      hrefLabel: 'Full report',
    })
  })

  /*
   * Absent, not defaulted. Most cards should carry neither: a page where
   * everything is coloured has no emphasis, it just has more colours.
   */
  it('says nothing about colour for a card that chose none', async () => {
    const app = await appWith([{ kind: 'count', title: 'People', model: 'User' }])

    const [widget] = await widgets(app)
    expect(widget).not.toHaveProperty('color')
    expect(widget).not.toHaveProperty('icon')
  })
})

describe('a list widget with columns', () => {
  it('sends a value per named column', async () => {
    const app = await appWith([
      { kind: 'list', title: 'Latest', model: 'User', columns: ['name', 'role'] },
    ])

    const [widget] = await widgets(app)
    expect(widget.data.columns).toEqual(['name', 'role'])
    expect(widget.data.records[0].values).toMatchObject({ name: expect.any(String) })
  })

  /*
   * Narrowed rather than refused. A column that was renamed should cost this
   * card that column, not the whole card - the others still answer.
   */
  it('drops a column the model does not have', async () => {
    const app = await appWith([
      { kind: 'list', title: 'Latest', model: 'User', columns: ['name', 'ghost'] },
    ])

    expect((await widgets(app))[0].data.columns).toEqual(['name'])
  })

  it('stays a list of names when none were asked for', async () => {
    const app = await appWith([{ kind: 'list', title: 'Latest', model: 'User' }])

    const [widget] = await widgets(app)
    expect(widget.data).not.toHaveProperty('columns')
    expect(widget.data.records[0]).not.toHaveProperty('values')
  })
})

describe('a chart', () => {
  /*
   * The default changed in 0.19.0, and it was a correction: thirty daily bars
   * are thirty shapes the eye has to assemble into a trend.
   */
  it('is an area unless the application asked for something else', async () => {
    const app = await appWith([{ kind: 'chart', title: 'People', model: 'User', buckets: 3 }])

    expect((await widgets(app))[0].data.display).toBe('area')
  })

  it('is drawn the way the application asked', async () => {
    const app = await appWith([
      { kind: 'chart', title: 'People', model: 'User', buckets: 3, display: 'bar' },
    ])

    expect((await widgets(app))[0].data.display).toBe('bar')
  })
})
