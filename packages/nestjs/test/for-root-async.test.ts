/**
 * `forRootAsync` - the admin configured through dependency injection.
 *
 * The case it exists for is the ordinary one: the adapter needs a client that
 * belongs to another module, and the auth policy needs configuration. Neither
 * is available where the module is declared, so `forRoot` cannot express it
 * without constructing a database client at import time.
 */
import { Injectable, Module, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { unsafeAllowAllRequests, type AdminAuth } from '../src/auth/contract.js'
import { AdminModule, type AdminModuleOptionsFactory } from '../src/module.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const seeded = () => new InMemoryAdapter({ User: [{ id: 'u1', email: 'ada@example.com' }] })

/** A provider from somewhere else in the application - the usual situation. */
@Injectable()
class DatabaseService {
  readonly adapter = seeded()
}

@Module({ providers: [DatabaseService], exports: [DatabaseService] })
class DatabaseModule {}

const boot = async (imported: Parameters<typeof Test.createTestingModule>[0]['imports']) => {
  app = (await Test.createTestingModule({ imports: imported }).compile()).createNestApplication()
  await app.init()
  return app.getHttpServer()
}

describe('useFactory', () => {
  it('resolves the adapter from an injected provider', async () => {
    const server = await boot([
      AdminModule.forRootAsync({
        imports: [DatabaseModule],
        inject: [DatabaseService],
        uiRoot: BUILT_UI_ROOT,
        useFactory: ((database: DatabaseService) => ({
          adapter: database.adapter,
          auth: unsafeAllowAllRequests(),
        })) as never,
      }),
    ])

    await request(server).get('/admin/meta').expect(200)
    await request(server).get('/admin/User').expect(200)
  })

  it('accepts an async factory', async () => {
    const server = await boot([
      AdminModule.forRootAsync({
        uiRoot: BUILT_UI_ROOT,
        useFactory: (async () => {
          await Promise.resolve()
          return { adapter: seeded(), auth: unsafeAllowAllRequests() }
        }) as never,
      }),
    ])

    await request(server).get('/admin/User').expect(200)
  })

  it('runs the factory once, however many options are injected', async () => {
    // Four providers read from the resolved object. A factory that opens a
    // connection must not be called four times.
    const useFactory = vi.fn(() => ({ adapter: seeded(), auth: unsafeAllowAllRequests() }))

    await boot([
      AdminModule.forRootAsync({ uiRoot: BUILT_UI_ROOT, useFactory: useFactory as never }),
    ])

    expect(useFactory).toHaveBeenCalledTimes(1)
  })

  it('carries the resource selection through', async () => {
    const server = await boot([
      AdminModule.forRootAsync({
        uiRoot: BUILT_UI_ROOT,
        useFactory: (() => ({
          adapter: seeded(),
          auth: unsafeAllowAllRequests(),
          resources: { include: ['User'] },
        })) as never,
      }),
    ])

    const meta = await request(server).get('/admin/meta').expect(200)
    expect(meta.body.data.models.map((model: { name: string }) => model.name)).toEqual(['User'])
    await request(server).get('/admin/Post').expect(404)
  })

  it('applies the resource policy the factory returned', async () => {
    const server = await boot([
      AdminModule.forRootAsync({
        uiRoot: BUILT_UI_ROOT,
        useFactory: (() => ({
          adapter: seeded(),
          auth: unsafeAllowAllRequests(),
          resourceAuth: {
            authorize: ({ operation }: { operation: string }) => operation !== 'delete',
          },
        })) as never,
      }),
    ])

    await request(server).get('/admin/User').expect(200)
    await request(server).delete('/admin/User/u1').expect(403)
  })
})

describe('useClass and useExisting', () => {
  @Injectable()
  class AdminOptions implements AdminModuleOptionsFactory {
    createAdminOptions() {
      return { adapter: seeded(), auth: unsafeAllowAllRequests() }
    }
  }

  it('instantiates useClass and asks it', async () => {
    const server = await boot([
      AdminModule.forRootAsync({ uiRoot: BUILT_UI_ROOT, useClass: AdminOptions }),
    ])

    await request(server).get('/admin/User').expect(200)
  })

  it('reuses an options factory the application already provides', async () => {
    @Module({ providers: [AdminOptions], exports: [AdminOptions] })
    class OptionsModule {}

    const server = await boot([
      AdminModule.forRootAsync({
        imports: [OptionsModule],
        uiRoot: BUILT_UI_ROOT,
        useExisting: AdminOptions,
      }),
    ])

    await request(server).get('/admin/User').expect(200)
  })
})

describe('the mount path', () => {
  it('is configurable, and stays on the options object', async () => {
    // Routes are registered before any provider exists, so `path` cannot come
    // from the factory. Offering it there and ignoring it would be worse than
    // not offering it.
    const server = await boot([
      AdminModule.forRootAsync({
        path: '/panel',
        uiRoot: BUILT_UI_ROOT,
        useFactory: (() => ({ adapter: seeded(), auth: unsafeAllowAllRequests() })) as never,
      }),
    ])

    await request(server).get('/panel/meta').expect(200)
    await request(server).get('/admin/meta').expect(404)

    const shell = await request(server).get('/panel').expect(200)
    expect(shell.text).toContain('window.__NEST_ADMIN_BASE__ = "/panel"')
  })
})

describe('rejecting unusable configuration', () => {
  it('needs one of the three providers', () => {
    expect(() => AdminModule.forRootAsync({})).toThrow(/useFactory.*useClass.*useExisting/s)
  })

  it('rejects a bad path immediately, not when the factory resolves', () => {
    // The path is structural, so this is knowable without running anything.
    expect(() =>
      AdminModule.forRootAsync({
        path: '/',
        useFactory: (() => ({ adapter: seeded(), auth: unsafeAllowAllRequests() })) as never,
      }),
    ).toThrow(/cannot be empty/)
  })

  it('rejects a factory that returns no adapter, naming forRootAsync', async () => {
    await expect(
      boot([
        AdminModule.forRootAsync({
          uiRoot: BUILT_UI_ROOT,
          useFactory: (() => ({ auth: unsafeAllowAllRequests() })) as never,
        }),
      ]),
    ).rejects.toThrow(/forRootAsync\(\) requires an `adapter`/)
  })

  it('rejects a factory that returns no auth', async () => {
    // The same rule as `forRoot`: the admin is never public by default, and an
    // async factory must not be a way around that.
    await expect(
      boot([
        AdminModule.forRootAsync({
          uiRoot: BUILT_UI_ROOT,
          useFactory: (() => ({ adapter: seeded() })) as never,
        }),
      ]),
    ).rejects.toThrow(/requires an `auth`/)
  })

  it('rejects an auth without an authorize method', async () => {
    await expect(
      boot([
        AdminModule.forRootAsync({
          uiRoot: BUILT_UI_ROOT,
          useFactory: (() => ({ adapter: seeded(), auth: {} as AdminAuth })) as never,
        }),
      ]),
    ).rejects.toThrow(/requires an `auth`/)
  })
})
