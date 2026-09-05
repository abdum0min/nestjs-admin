/**
 * The developer tools, over HTTP.
 *
 * Two things are being asserted, and the second one matters more.
 *
 * The first is that generating works: rows appear, relations point at rows that
 * exist, the same seed gives the same data, and what a run created can be taken
 * back.
 *
 * The second is that none of it can happen where it should not. These routes
 * write hundreds of records and can empty a table, so the tests for the four
 * gates - the import, the option, the deployment check and the capability - are
 * the ones to read first.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import { devTools } from '../src/dev-tools/index.js'
import { deploymentSignal } from '../src/dev-tools/deployed.js'
import { AdminModule } from '../src/module.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const seed = () => ({ User: [], Post: [] })

async function boot(
  options: Parameters<typeof devTools>[0] | 'off' = {},
  extra: Record<string, unknown> = {},
) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter(seed()),
        auth: unsafeAllowAllRequests(),
        // The tools write files for image columns; off here so the suite does
        // not litter a directory, and covered separately by the files suite.
        files: false,
        ...(options === 'off' ? {} : { devTools: devTools(options) }),
        ...extra,
      }),
    ],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()
  return app.getHttpServer()
}

const post = (server: unknown, path: string, body: unknown = {}) =>
  request(server as never)
    .post(`/admin/dev${path}`)
    .send(body as object)

describe('the four gates', () => {
  it('has no routes at all when the application did not import them', async () => {
    // The first gate, and the only one a configuration mistake cannot undo:
    // without the import there is no controller to register.
    const server = await boot('off')

    await request(server).get('/admin/dev').expect(404)
    await post(server, '/generate', { model: 'User' }).expect(404)
  })

  it('refuses to build where the process looks deployed', async () => {
    const before = process.env['RENDER']
    process.env['RENDER'] = 'srv-abc'

    try {
      // A start-up failure rather than a warning. A warning about a tool that
      // can empty a table is one somebody reads afterwards.
      expect(() => devTools()).toThrow(/looks like a deployment/)
      expect(() => devTools()).toThrow(/RENDER/)
      // And the second, explicit acknowledgement gets through.
      expect(() => devTools({ allowInProduction: true })).not.toThrow()
    } finally {
      if (before === undefined) delete process.env['RENDER']
      else process.env['RENDER'] = before
    }
  })

  it('does not rest on NODE_ENV alone', async () => {
    // Staging runs as production, plenty of deployments never set it, and a
    // container built with NODE_ENV=development would sail past it.
    const before = { node: process.env['NODE_ENV'], k8s: process.env['KUBERNETES_SERVICE_HOST'] }
    process.env['NODE_ENV'] = 'development'
    process.env['KUBERNETES_SERVICE_HOST'] = '10.0.0.1'

    try {
      const signal = deploymentSignal()
      expect(signal.deployed).toBe(true)
      expect(signal.because).toContain('KUBERNETES_SERVICE_HOST')
    } finally {
      if (before.node === undefined) delete process.env['NODE_ENV']
      else process.env['NODE_ENV'] = before.node
      if (before.k8s === undefined) delete process.env['KUBERNETES_SERVICE_HOST']
      else process.env['KUBERNETES_SERVICE_HOST'] = before.k8s
    }
  })

  it('says nothing about a laptop', async () => {
    const signal = deploymentSignal({} as NodeJS.ProcessEnv)
    expect(signal.deployed).toBe(false)
    expect(signal.because).toEqual([])
  })

  it('refuses a role without the capability', async () => {
    // The fourth gate. Without roles every administrator has it, as with
    // `manageTeam`; with roles it has to be granted.
    const server = await boot(
      {},
      {
        roles: { viewer: { models: { User: ['metadata', 'list', 'read', 'create'] } } },
        roleOf: () => 'viewer',
      },
    )

    const { body } = await request(server).get('/admin/dev').expect(403)
    expect(body.error.message).toMatch(/developer tools/)
  })

  it('offers the capability to a role that has it', async () => {
    const server = await boot(
      {},
      {
        roles: {
          seeder: {
            models: { User: ['metadata', 'list', 'read', 'create'] },
            capabilities: ['useDevTools'],
          },
        },
        roleOf: () => 'seeder',
      },
    )

    await request(server).get('/admin/dev').expect(200)
  })

  it('tells the interface whether the screen exists at all', async () => {
    const withTools = await boot()
    const without = await boot('off')

    const on = await request(withTools).get('/admin/meta').expect(200)
    expect(on.body.data.capabilities.useDevTools).toBe(true)

    // A build without them and a role without the capability look identical
    // from a screen, which is right: in both cases they are not part of this
    // admin.
    await app?.close()
    const off = await request(without).get('/admin/meta').expect(200)
    expect(off.body.data.capabilities.useDevTools).toBe(false)
  })
})

describe('generating', () => {
  it('creates records that were not there', async () => {
    const server = await boot()

    const { body } = await post(server, '/generate', { model: 'User', count: 8 }).expect(201)
    expect(body.data.created).toBe(8)

    const list = await request(server).get('/admin/User').expect(200)
    expect(list.body.meta.total).toBe(8)
  })

  it('writes values a person would recognise', async () => {
    const server = await boot()
    await post(server, '/generate', { model: 'User', count: 5 }).expect(201)

    const { body } = await request(server).get('/admin/User').expect(200)
    for (const row of body.data) {
      expect(String(row.email)).toContain('@')
      // Not `string-1`. A table of those proves the generator ran and nothing
      // else, which is the failure mode this whole feature exists to avoid.
      expect(String(row.name)).not.toMatch(/^string/)
    }
  })

  it('previews without writing', async () => {
    const server = await boot()

    const { body } = await post(server, '/preview', { model: 'User', count: 3 }).expect(201)
    expect(body.data.records).toHaveLength(3)

    const list = await request(server).get('/admin/User').expect(200)
    expect(list.body.meta.total).toBe(0)
  })

  it('repeats itself when given the same seed', async () => {
    const first = await post(await boot(), '/preview', {
      model: 'User',
      count: 3,
      seed: 'demo',
    }).expect(201)
    await app?.close()

    const second = await post(await boot(), '/preview', {
      model: 'User',
      count: 3,
      seed: 'demo',
    }).expect(201)

    // What makes a generated demo something a person can screenshot, describe
    // to somebody else, and get back after a truncate.
    expect(second.body.data.records).toEqual(first.body.data.records)
  })

  it('refuses more than the limit in one request', async () => {
    const server = await boot({ maxPerRun: 10 })

    const { body } = await post(server, '/generate', { model: 'User', count: 50 }).expect(400)
    expect(body.error.message).toMatch(/limit is 10/)
  })

  it('will not touch a model the configuration excluded', async () => {
    const server = await boot({ models: ['User'] })

    const { body } = await post(server, '/generate', { model: 'Post', count: 2 }).expect(403)
    expect(body.error.message).toMatch(/not to touch/)
  })

  it('says what is missing rather than failing at the database', async () => {
    // A Post needs an author. Reported as a sentence naming the model to
    // generate first, instead of two hundred foreign-key violations.
    const server = await boot()

    const { body } = await post(server, '/generate', { model: 'Post', count: 3 }).expect(201)
    expect(body.data.created).toBe(0)
    expect(body.data.failed[0].reason).toMatch(/Needs a User/)
  })
})

describe('filling the whole admin', () => {
  it('creates parents before children, so relations point at something', async () => {
    const server = await boot()

    const { body } = await post(server, '/fill', { perModel: 4 }).expect(201)
    const order = body.data.map((run: { model: string }) => run.model)
    expect(order).toEqual(['User', 'Post'])

    const posts = await request(server).get('/admin/Post').expect(200)
    expect(posts.body.data).toHaveLength(4)
    for (const row of posts.body.data) expect(row.authorId).toBeTruthy()
  })

  it('leaves every created record reachable through the ordinary routes', async () => {
    // Written through the adapter, so this is worth checking rather than
    // assuming: a seeder that produced rows the admin could not read would be
    // worse than none.
    const server = await boot()
    await post(server, '/fill', { perModel: 3 }).expect(201)

    const list = await request(server).get('/admin/Post').expect(200)
    const id = list.body.data[0].id
    await request(server).get(`/admin/Post/${id}`).expect(200)
  })
})

describe('taking it back', () => {
  it('deletes what the last run created and nothing else', async () => {
    const server = await boot()

    // A record that was already there, by hand.
    await request(server)
      .post('/admin/User')
      .send({ email: 'real@example.com', name: 'Real', active: true, role: 'ADMIN' })
      .expect(201)

    await post(server, '/generate', { model: 'User', count: 6 }).expect(201)
    expect((await request(server).get('/admin/User')).body.meta.total).toBe(7)

    await post(server, '/undo').expect(201)

    const left = await request(server).get('/admin/User').expect(200)
    expect(left.body.meta.total).toBe(1)
    expect(left.body.data[0].email).toBe('real@example.com')
  })

  it('deletes children before parents', async () => {
    const server = await boot()
    await post(server, '/fill', { perModel: 3 }).expect(201)

    await post(server, '/undo').expect(201)

    expect((await request(server).get('/admin/User')).body.meta.total).toBe(0)
    expect((await request(server).get('/admin/Post')).body.meta.total).toBe(0)
  })

  it('says so when there is nothing to undo', async () => {
    const server = await boot()
    const { body } = await post(server, '/undo').expect(400)
    expect(body.error.message).toMatch(/Nothing has been generated/)
  })
})

describe('emptying a model', () => {
  it('removes its rows and reports what is left', async () => {
    const server = await boot()
    await post(server, '/generate', { model: 'User', count: 5 }).expect(201)

    const { body } = await post(server, '/truncate', { model: 'User' }).expect(201)
    expect(body.data.deleted).toBe(5)
    expect(body.data.remaining).toBe(0)
    expect((await request(server).get('/admin/User')).body.meta.total).toBe(0)
  })

  it('needs a model, and says so rather than emptying something', async () => {
    const server = await boot()
    await post(server, '/truncate', {}).expect(400)
  })
})

describe('route order', () => {
  it('does not read `dev` as a model name', async () => {
    // The same rule `meta`, `dashboard`, `actions`, `team` and `files` rely on.
    // Registered after the controller that owns `:model`, this would 404.
    const server = await boot()
    await request(server).get('/admin/dev').expect(200)
  })
})

describe('what the screen is told', () => {
  it('answers everything the page needs in one request', async () => {
    // One request, deliberately: a page that asks five questions to render its
    // header spends its first second half-drawn, and this one is opened dozens
    // of times a day.
    const server = await boot()
    const { body } = await request(server).get('/admin/dev').expect(200)

    expect(body.data.adapter).toBe('in-memory')
    expect(body.data.environment).toMatchObject({ deployed: false, because: [] })
    expect(body.data.models.map((entry: { name: string }) => entry.name)).toEqual(['User', 'Post'])
    expect(body.data.totalRecords).toBe(0)
    expect(body.data.history).toEqual([])
  })

  it('says how many relations each model will wire up', async () => {
    const server = await boot()
    const { body } = await request(server).get('/admin/dev').expect(200)

    const post = body.data.models.find((entry: { name: string }) => entry.name === 'Post')
    expect(post.relations).toBe(1)
  })

  it('counts what is already there', async () => {
    const server = await boot()
    await post(server, '/generate', { model: 'User', count: 4 }).expect(201)

    const { body } = await request(server).get('/admin/dev').expect(200)
    const user = body.data.models.find((entry: { name: string }) => entry.name === 'User')
    expect(user.records).toBe(4)
    expect(body.data.totalRecords).toBe(4)
  })

  it('keeps a history of runs, newest first', async () => {
    const server = await boot()
    await post(server, '/generate', { model: 'User', count: 2 }).expect(201)
    await post(server, '/generate', { model: 'User', count: 3 }).expect(201)

    const { body } = await request(server).get('/admin/dev').expect(200)
    expect(body.data.history).toHaveLength(2)
    expect(body.data.history[0].runs[0].created).toBe(3)
  })
})

describe('generating several models at once', () => {
  it('gives each model the number it was asked for', async () => {
    // Not one model at a time, and not one number for all of them.
    const server = await boot()

    const { body } = await post(server, '/fill', {
      models: [
        { name: 'User', count: 6 },
        { name: 'Post', count: 2 },
      ],
    }).expect(201)

    expect(
      body.data.map((run: { model: string; created: number }) => [run.model, run.created]),
    ).toEqual([
      ['User', 6],
      ['Post', 2],
    ])
  })

  it('orders them by the relations, whatever order they were listed in', async () => {
    // A request that names Post before User is not a request to create orphans.
    const server = await boot()

    const { body } = await post(server, '/fill', {
      models: [
        { name: 'Post', count: 2 },
        { name: 'User', count: 2 },
      ],
    }).expect(201)

    expect(body.data.map((run: { model: string }) => run.model)).toEqual(['User', 'Post'])
    const posts = await request(server).get('/admin/Post').expect(200)
    for (const row of posts.body.data) expect(row.authorId).toBeTruthy()
  })

  it('leaves out a model the caller did not name', async () => {
    const server = await boot()
    await post(server, '/fill', { models: [{ name: 'User', count: 3 }] }).expect(201)

    expect((await request(server).get('/admin/Post')).body.meta.total).toBe(0)
  })
})

describe('emptying everything', () => {
  it('refuses without the acknowledgement, and deletes nothing', async () => {
    const server = await boot()
    await post(server, '/fill', { perModel: 3 }).expect(201)

    await post(server, '/reset', {}).expect(400)
    expect((await request(server).get('/admin/User')).body.meta.total).toBe(3)
  })

  it('empties every model, children first', async () => {
    // Reverse dependency order: a parent cannot go while its children still
    // point at it.
    const server = await boot()
    await post(server, '/fill', { perModel: 3 }).expect(201)

    const { body } = await post(server, '/reset', { confirm: true }).expect(201)
    expect(body.data.emptied.map((entry: { model: string }) => entry.model)).toEqual([
      'Post',
      'User',
    ])

    expect((await request(server).get('/admin/User')).body.meta.total).toBe(0)
    expect((await request(server).get('/admin/Post')).body.meta.total).toBe(0)
  })

  it('needs the capability like everything else here', async () => {
    const server = await boot(
      {},
      {
        roles: { viewer: { models: { User: ['metadata', 'list', 'read', 'create'] } } },
        roleOf: () => 'viewer',
      },
    )

    await post(server, '/reset', { confirm: true }).expect(403)
  })
})

describe('what emptying everything leaves alone', () => {
  it('names the models outside this admin, and why', async () => {
    // The button says "every model" and means every model this admin manages.
    // Somebody who believes the shorter version will eventually be wrong about
    // their own database, so the difference is on the screen rather than in a
    // paragraph of documentation.
    const server = await boot({}, { resources: { exclude: ['Post'] } })

    const { body } = await post(server, '/reset', { confirm: true }).expect(201)

    expect(body.data.emptied.map((entry: { model: string }) => entry.model)).toEqual(['User'])
    expect(body.data.skipped).toEqual([{ model: 'Post', reason: 'outside this admin' }])
  })

  it('names the models the configuration told it not to touch', async () => {
    const server = await boot({ models: ['User'] })

    const { body } = await post(server, '/reset', { confirm: true }).expect(201)
    expect(body.data.skipped).toEqual([
      { model: 'Post', reason: 'not in the developer tools configuration' },
    ])
  })

  it('does not cross the resources boundary, however the request is made', async () => {
    // `resources` is the whole of this package's security model. A developer
    // tool that ignored it would make every `exclude` in every application a
    // suggestion - and the excluded table is usually the one holding the login
    // of the person pressing the button.
    const server = await boot({}, { resources: { exclude: ['Post'] } })

    await post(server, '/generate', { model: 'Post', count: 1 }).expect(404)
    await post(server, '/truncate', { model: 'Post' }).expect(404)
    await post(server, '/reset', { confirm: true }).expect(201)

    // Still reachable through nothing at all: it is not part of this admin.
    await request(server).get('/admin/Post').expect(404)
  })

  it('says nothing when there was nothing to leave alone', async () => {
    const server = await boot()
    const { body } = await post(server, '/reset', { confirm: true }).expect(201)
    expect(body.data.skipped).toEqual([])
  })
})
