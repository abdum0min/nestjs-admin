/**
 * `resources` - which models the admin exposes at all.
 *
 * The distinction under test throughout is between *structural* and
 * *per-principal*. A model outside the selection is not part of this admin, so
 * it answers 404, and answers it identically for everyone; a model denied by
 * `resourceAuth` exists, and answers 403. Collapsing the two would either leak
 * that a hidden table exists or make a missing one look like a permissions
 * problem.
 *
 * The unit tests below name a `Session` model because that is the usual reason
 * to reach for this option. The HTTP tests use the two models the in-memory
 * adapter actually has, and exclude `Post`.
 */
import { ForbiddenError, selectModels, unknownSelectionNames } from '@nest-admin/core'
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

const records = () => ({
  User: [{ id: 'u1', email: 'ada@example.com' }],
  Post: [{ id: 'p1', title: 'Hello' }],
})

const boot = async (resources?: Parameters<typeof createAdminApp>[4]) => {
  app = await createAdminApp(
    new InMemoryAdapter(records()),
    undefined,
    undefined,
    undefined,
    resources,
  )
  return app.getHttpServer()
}

const modelNames = async (server: unknown): Promise<string[]> => {
  const response = await request(server as never)
    .get('/admin/meta')
    .expect(200)
  return (response.body.data.models as Array<{ name: string }>).map((model) => model.name)
}

describe('selectModels', () => {
  const models = [{ name: 'User' }, { name: 'Post' }, { name: 'Session' }]

  it('returns everything when unset', () => {
    expect(selectModels(models)).toEqual(models)
  })

  it('include keeps only what is listed', () => {
    expect(selectModels(models, { include: ['User'] })).toEqual([{ name: 'User' }])
  })

  it('exclude removes what is listed', () => {
    expect(selectModels(models, { exclude: ['Session'] })).toEqual([
      { name: 'User' },
      { name: 'Post' },
    ])
  })

  it('applies exclude after include', () => {
    expect(selectModels(models, { include: ['User', 'Session'], exclude: ['Session'] })).toEqual([
      { name: 'User' },
    ])
  })

  it('keeps the adapter order, not the order of include', () => {
    // Otherwise editing the list would silently reshuffle the admin.
    expect(selectModels(models, { include: ['Session', 'User'] })).toEqual([
      { name: 'User' },
      { name: 'Session' },
    ])
  })

  it('an empty include exposes nothing, which is not the same as unset', () => {
    expect(selectModels(models, { include: [] })).toEqual([])
    expect(selectModels(models, {})).toEqual(models)
  })
})

describe('unknownSelectionNames', () => {
  const models = [{ name: 'User' }]

  it('finds names no model answers to, from either list', () => {
    expect(unknownSelectionNames(models, { include: ['User', 'Nope'] })).toEqual(['Nope'])
    expect(unknownSelectionNames(models, { exclude: ['Sesion'] })).toEqual(['Sesion'])
  })

  it('reports each name once', () => {
    expect(unknownSelectionNames(models, { include: ['Nope'], exclude: ['Nope'] })).toEqual([
      'Nope',
    ])
  })

  it('says nothing when everything is known, or when unset', () => {
    expect(unknownSelectionNames(models, { include: ['User'] })).toEqual([])
    expect(unknownSelectionNames(models)).toEqual([])
  })
})

describe('an excluded model over HTTP', () => {
  it('is absent from the metadata document', async () => {
    const server = await boot({ exclude: ['Post'] })

    expect(await modelNames(server)).toEqual(['User'])
  })

  it('answers 404, not 403', async () => {
    // It is not that the caller may not have it; it is not there.
    const server = await boot({ exclude: ['Post'] })

    const response = await request(server).get('/admin/Post').expect(404)

    expect(response.body.error.code).toBe('MODEL_NOT_FOUND')
  })

  it('is unreachable by every verb, not just the ones that read', async () => {
    const server = await boot({ exclude: ['Post'] })

    await request(server).get('/admin/Post/p1').expect(404)
    await request(server).post('/admin/Post').send({ title: 'x' }).expect(404)
    await request(server).patch('/admin/Post/p1').send({ title: 'x' }).expect(404)
    await request(server).delete('/admin/Post/p1').expect(404)
  })

  it('is not named in the error, which lists only exposed models', async () => {
    const server = await boot({ exclude: ['Post'] })

    const response = await request(server).get('/admin/Nope').expect(404)

    expect(response.text).not.toContain('Post')
  })

  it('leaves the rest of the admin working', async () => {
    const server = await boot({ exclude: ['Post'] })

    await request(server).get('/admin/User').expect(200)
    await request(server).post('/admin/User').send({ email: 'x@y.z', name: 'X' }).expect(201)
  })
})

describe('include', () => {
  it('exposes only what is listed', async () => {
    const server = await boot({ include: ['User'] })

    expect(await modelNames(server)).toEqual(['User'])
    await request(server).get('/admin/Post').expect(404)
    await request(server).get('/admin/User').expect(200)
  })
})

describe('no selection', () => {
  it('exposes everything the adapter reports', async () => {
    const server = await boot()

    expect(await modelNames(server)).toEqual(['User', 'Post'])
  })
})

describe('a selection naming a model that does not exist', () => {
  const bootWith = async (resources: { include?: string[]; exclude?: string[] }) => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AdminModule.forRoot({
          adapter: new InMemoryAdapter(records()),
          auth: unsafeAllowAllRequests(),
          resources,
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  }

  it('fails at startup rather than being ignored', async () => {
    // A typo in `exclude` would otherwise leave the model exposed - the exact
    // opposite of what was asked for, and silent.
    await expect(bootWith({ exclude: ['Sesion'] })).rejects.toThrow(/Sesion/)
  })

  it('says what the schema does have', async () => {
    await expect(bootWith({ include: ['Users'] })).rejects.toThrow(/User, Post/)
  })
})

describe('selection and resource authorization together', () => {
  it('answers 404 for excluded and 403 for denied', async () => {
    app = await createAdminApp(
      new InMemoryAdapter(records()),
      undefined,
      {
        authorize: ({ model }) => {
          if (model === 'User') throw new ForbiddenError()
          return true
        },
      },
      undefined,
      { exclude: ['Post'] },
    )
    const server = app.getHttpServer()

    // Excluded: structural, so the same answer for every principal.
    await request(server).get('/admin/Post').expect(404)
    // Denied: it exists, this caller may not have it.
    await request(server).get('/admin/User').expect(403)
  })
})
