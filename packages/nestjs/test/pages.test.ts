/**
 * Custom pages, over real HTTP.
 *
 * What is worth proving is not that a page renders - it is that adding one
 * cannot weaken or disturb anything that was already there:
 *
 * - a page's `can` is enforced on the request, not only on the sidebar
 * - a widget on a page is authorized exactly as it is on the dashboard
 * - a page cannot take a route a model or a built-in screen owns
 * - an admin that declares none is byte-for-byte the admin it was
 */
import { Test } from '@nestjs/testing'
import { Controller, Get, UseFilters, UseGuards } from '@nestjs/common'
import type { INestApplication, ExecutionContext } from '@nestjs/common'
import { UnauthorizedError } from '@nest-admin/core'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { AdminAuthGuard } from '../src/auth/guard.js'
import { AdminExceptionFilter } from '../src/http/exception.filter.js'
import { unsafeAllowAllRequests, type AdminAuth } from '../src/auth/contract.js'
import type { AdminResourceAuth } from '../src/auth/resource.js'
import { AdminModule } from '../src/module.js'
import type { AdminPages } from '../src/pages/contract.js'
import type { AdminNavigation } from '@nest-admin/core'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

const USERS = [
  { id: 'u1', email: 'ada@example.com', name: 'Ada', active: true },
  { id: 'u2', email: 'bob@example.com', name: 'Bob', active: false },
]

const POSTS = [{ id: 'p1', title: 'First', published: true, authorId: 'u1' }]

const apps: INestApplication[] = []

/**
 * A trail that can be read back.
 *
 * Its presence is what makes the dashboard offer an activity card nobody
 * declared - which is exactly the rule a custom page must not inherit, so a
 * test about that has to have one configured or it proves nothing.
 */
const readableTrail = {
  store: {
    record: () => undefined,
    list: async () => ({ data: [], total: 0, page: 1, perPage: 25 }),
    countSince: async () => 3,
  },
}

async function appWith(options: {
  pages?: AdminPages
  navigation?: AdminNavigation
  resourceAuth?: AdminResourceAuth
  audit?: boolean
}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter({ User: USERS, Post: POSTS }),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        ...(options.audit === true ? { audit: readableTrail } : {}),
        ...(options.pages === undefined ? {} : { pages: options.pages }),
        ...(options.navigation === undefined ? {} : { navigation: options.navigation }),
        ...(options.resourceAuth === undefined ? {} : { resourceAuth: options.resourceAuth }),
      }),
    ],
  }).compile()

  const app = moduleRef.createNestApplication()

  // Registered for teardown *before* `init`, not after. The startup tests below
  // exist to make `init` throw, and pushing afterwards left one half-built Nest
  // application alive per refusal, for the rest of the run.
  apps.push(app)
  await app.init()
  return app
}

/** Refuses unless the request carries the header. Stands in for a real policy. */
const onlyWithHeader = (context: ExecutionContext): boolean =>
  context.switchToHttp().getRequest<{ headers: Record<string, string> }>().headers['x-ops'] ===
  'yes'

const meta = async (app: INestApplication) =>
  (await request(app.getHttpServer()).get('/admin/meta').expect(200)).body.data

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
})

describe('the metadata document', () => {
  it('says nothing about pages when an admin has none', async () => {
    const app = await appWith({})
    expect(await meta(app)).not.toHaveProperty('pages')
  })

  it('carries a page, with only what drawing it needs', async () => {
    const app = await appWith({
      pages: [{ path: 'runbook', title: 'Runbook', url: '/notes.html' }],
    })

    expect((await meta(app)).pages).toEqual([
      { path: 'runbook', title: 'Runbook', kind: 'embed', url: '/notes.html' },
    ])
  })

  /*
   * The rule is the same one models have: what nobody placed is collected,
   * never dropped. A page vanishing from the sidebar because somebody edited a
   * heading is the failure this prevents.
   */
  it('places a page where the navigation put it, and collects the rest', async () => {
    const app = await appWith({
      pages: [
        { path: 'placed', title: 'Placed', url: '/a.html' },
        { path: 'loose', title: 'Loose', url: '/b.html' },
      ],
      navigation: [{ heading: 'Ops', models: ['User'], pages: ['placed'] }],
    })

    const navigation = (await meta(app)).navigation

    expect(navigation).toContainEqual({
      kind: 'group',
      heading: 'Ops',
      models: ['User'],
      pages: ['placed'],
    })
    expect(navigation).toContainEqual({
      kind: 'group',
      heading: 'Other',
      models: ['Post'],
      pages: ['loose'],
    })
  })

  it('allows a heading that holds only pages', async () => {
    const app = await appWith({
      pages: [{ path: 'runbook', title: 'Runbook', url: '/notes.html' }],
      navigation: [
        { heading: 'Everything', models: ['User', 'Post'] },
        { heading: 'Tools', pages: ['runbook'] },
      ],
    })

    expect((await meta(app)).navigation).toContainEqual({
      kind: 'group',
      heading: 'Tools',
      models: [],
      pages: ['runbook'],
    })
  })

  it('leaves out a page this principal may not open', async () => {
    const app = await appWith({
      pages: [
        { path: 'open', title: 'Open', url: '/a.html' },
        { path: 'closed', title: 'Closed', url: '/b.html', can: onlyWithHeader },
      ],
    })

    const document = await meta(app)
    expect(document.pages.map((page: { path: string }) => page.path)).toEqual(['open'])

    const permitted = (
      await request(app.getHttpServer()).get('/admin/meta').set('x-ops', 'yes').expect(200)
    ).body.data

    expect(permitted.pages.map((page: { path: string }) => page.path)).toEqual(['open', 'closed'])
  })
})

describe('a page built from widgets', () => {
  it('resolves through the same code the dashboard uses', async () => {
    const app = await appWith({
      pages: [
        {
          path: 'health',
          title: 'Health',
          widgets: [
            { kind: 'count', title: 'People', model: 'User' },
            { kind: 'count', title: 'Posts', model: 'Post' },
          ],
        },
      ],
    })

    const { body } = await request(app.getHttpServer()).get('/admin/pages/health').expect(200)

    expect(body.data.widgets).toHaveLength(2)
    expect(body.data.widgets[0]).toMatchObject({ kind: 'count', title: 'People' })
    expect(body.data.widgets[0].data).toMatchObject({ value: 2 })
  })

  /*
   * Found live, not here: the page declared four widgets and drew five.
   *
   * The dashboard appends an activity card when nobody placed one, and sharing
   * its resolver handed that rule to every page too. It is the dashboard's rule
   * alone - a declared page must be the page its author declared, or declaring
   * one means nothing.
   */
  it('adds nothing the page did not declare, even where the dashboard would', async () => {
    const app = await appWith({
      // Without this the test cannot fail: the card is only ever appended where
      // there is a readable trail, so an admin with none proves nothing.
      audit: true,
      pages: [
        {
          path: 'health',
          title: 'Health',
          widgets: [{ kind: 'count', title: 'People', model: 'User' }],
        },
      ],
    })

    const { body } = await request(app.getHttpServer()).get('/admin/pages/health').expect(200)

    expect(body.data.widgets).toHaveLength(1)
    expect(body.data.widgets.map((widget: { kind: string }) => widget.kind)).toEqual(['count'])

    // And the dashboard in the same admin still gets one, so this narrowed the
    // rule rather than removing it.
    const dashboard = await request(app.getHttpServer()).get('/admin/dashboard').expect(200)
    expect(
      dashboard.body.data.widgets.some((widget: { kind: string }) => widget.kind === 'activity'),
    ).toBe(true)
  })

  /*
   * The important one. A page is configuration, and configuration must not be
   * a way around a policy - a widget counting a model this principal cannot
   * list has to be gone before anything is queried, exactly as on the
   * dashboard.
   */
  it('drops a widget over a model this principal cannot see', async () => {
    const app = await appWith({
      pages: [
        {
          path: 'health',
          title: 'Health',
          widgets: [
            { kind: 'count', title: 'People', model: 'User' },
            { kind: 'count', title: 'Posts', model: 'Post' },
          ],
        },
      ],
      resourceAuth: { authorize: ({ model }) => model !== 'Post' },
    })

    const { body } = await request(app.getHttpServer()).get('/admin/pages/health').expect(200)

    expect(body.data.widgets).toHaveLength(1)
    expect(body.data.widgets[0].title).toBe('People')
  })
})

describe('the page route', () => {
  /*
   * The sidebar never offered it. That is not what stops anyone: the URL is
   * typeable, and this is the check that matters.
   */
  it('refuses a page this principal may not open, however they arrived', async () => {
    const app = await appWith({
      pages: [
        {
          path: 'closed',
          title: 'Closed',
          widgets: [{ kind: 'count', title: 'x', model: 'User' }],
          can: onlyWithHeader,
        },
      ],
    })

    await request(app.getHttpServer()).get('/admin/pages/closed').expect(403)
    await request(app.getHttpServer()).get('/admin/pages/closed').set('x-ops', 'yes').expect(200)
  })

  it('reads as gone when the path names nothing', async () => {
    const app = await appWith({ pages: [{ path: 'a', title: 'A', url: '/a.html' }] })
    await request(app.getHttpServer()).get('/admin/pages/nope').expect(404)
  })

  it('says a module page has nothing here to fetch', async () => {
    const app = await appWith({
      pages: [{ path: 'own', title: 'Own', module: '/pages/own.js' }],
    })

    const { body } = await request(app.getHttpServer()).get('/admin/pages/own').expect(404)
    expect(body.error.message).toMatch(/draws itself/)

    // Found live: the message was wrapped into `Unknown model "The page at
    // ..."`, because the 404 this reuses builds its own sentence from a model
    // name. A page is not a model, and the reader should not be told it is.
    expect(body.error.message).not.toMatch(/Unknown model/)
  })

  /*
   * `pages` is a literal segment declared before the controller that owns
   * `:model`. Without that ordering this request would be read as "list the
   * model called pages", and the failure would be a confusing 404 about a
   * model nobody wrote.
   */
  it('does not shadow a model whose route it sits beside', async () => {
    const app = await appWith({ pages: [{ path: 'a', title: 'A', url: '/a.html' }] })

    const { body } = await request(app.getHttpServer()).get('/admin/User').expect(200)
    expect(body.data).toHaveLength(2)
  })
})

/**
 * The half of a custom page this package does not draw: its API.
 *
 * Both findings here came from running the example rather than from a test,
 * and both would have made the exported guard unusable in practice.
 */
describe('AdminAuthGuard, on a consumer controller', () => {
  @Controller('mine')
  @UseGuards(AdminAuthGuard)
  @UseFilters(AdminExceptionFilter)
  class MineController {
    @Get('data')
    data() {
      return { ok: true }
    }
  }

  const appFor = async (auth: AdminAuth) => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AdminModule.forRoot({
          adapter: new InMemoryAdapter({ User: USERS }),
          auth,
          uiRoot: BUILT_UI_ROOT,
        }),
      ],
      // Declared outside the admin module, which is the whole point: a
      // consumer's controller, resolving the admin's guard.
      controllers: [MineController],
    }).compile()

    const app = moduleRef.createNestApplication()
    apps.push(app)
    await app.init()
    return app
  }

  /*
   * Found live: exporting the guard class was not enough. Nest builds the guard
   * in the module that declares the controller, so its dependency has to be
   * resolvable there - without the token exported too, this failed at startup
   * with "AdminAuthGuard cannot resolve Symbol(nest-admin.auth)".
   */
  it('resolves in a module that only imports AdminModule', async () => {
    const app = await appFor(unsafeAllowAllRequests())
    await request(app.getHttpServer()).get('/mine/data').expect(200, { ok: true })
  })

  /*
   * Found live: this answered 500. The guard refuses with this package's
   * `UnauthorizedError`, which is not one of Nest's exceptions, so without the
   * filter the client cannot tell a sign-in problem from a crash - and the
   * admin's own fetch helper never triggers its sign-in flow.
   */
  it('refuses with 401 rather than 500 when the filter is used', async () => {
    const app = await appFor({
      authorize() {
        throw new UnauthorizedError()
      },
    })

    const { body } = await request(app.getHttpServer()).get('/mine/data').expect(401)
    expect(body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } })
  })
})

describe('startup', () => {
  const refuses = async (pages: AdminPages, expected: RegExp) => {
    await expect(appWith({ pages })).rejects.toThrow(expected)
  }

  it('refuses a path a built-in screen owns', async () => {
    await refuses([{ path: 'audit', title: 'A', url: '/a.html' }], /screen this admin already has/)
  })

  it('refuses two pages at one route', async () => {
    await refuses(
      [
        { path: 'same', title: 'A', url: '/a.html' },
        { path: 'same', title: 'B', url: '/b.html' },
      ],
      /an earlier page already claims/,
    )
  })

  it('refuses a path that cannot be a route', async () => {
    await refuses([{ path: 'Reports Page', title: 'A', url: '/a.html' }], /lowercase letters/)
  })

  /*
   * The one that is a security rule rather than a typo rule. Loading a module
   * from someone else's host would run their code on a page holding a session
   * that can write to every table.
   */
  it('refuses a module from another origin', async () => {
    await refuses(
      [{ path: 'a', title: 'A', module: 'https://cdn.example.com/page.js' }],
      /root-relative path/,
    )
  })

  it('refuses a page with no body', async () => {
    await refuses(
      [{ path: 'a', title: 'A' } as unknown as AdminPages[number]],
      /needs exactly one of/,
    )
  })

  it('refuses navigation naming a page that does not exist', async () => {
    await expect(
      appWith({
        pages: [{ path: 'real', title: 'Real', url: '/a.html' }],
        navigation: [{ heading: 'Ops', models: ['User'], pages: ['imaginary'] }],
      }),
    ).rejects.toThrow(/not a page this admin has/)
  })
})
