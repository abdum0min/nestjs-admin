/**
 * The seams an application writes into: hooks, actions, and branding.
 *
 * The admin knows a schema, not a domain. Hashing a password, refusing a
 * deletion, publishing a draft - none of these can be inferred from a column
 * type, and all of them are why a real application eventually stops using a
 * generic admin. These assert that the seams hold the guarantees the rest of
 * the package makes, rather than opening a way around them.
 */
import { ValidationError } from '@nest-admin/core'
import type { ExecutionContext, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdminAction, AdminActionsByModel } from '../src/actions/contract.js'
import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import type { AdminResourceAuth } from '../src/auth/resource.js'
import type { AdminHooksByModel } from '../src/hooks/contract.js'
import { AdminModule } from '../src/module.js'
import type { AdminTheme } from '../src/ui/theme.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const seed = () => ({
  User: [{ id: 'u1', email: 'ada@example.com', name: 'Ada', bio: 'First', age: 36 }],
  Post: [{ id: 'p1', title: 'First', authorId: 'u1' }],
})

const boot = async (options: {
  hooks?: AdminHooksByModel
  actions?: AdminActionsByModel
  theme?: AdminTheme
  resourceAuth?: AdminResourceAuth
}) => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter(seed()),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        ...options,
      }),
    ],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()
  return app.getHttpServer()
}

describe('hooks around a write', () => {
  it('can rewrite the data before it is stored', async () => {
    // The case this exists for: a value the schema cannot describe.
    const server = await boot({
      hooks: { User: { beforeCreate: ({ data }) => ({ ...data, bio: 'set by the hook' }) } },
    })

    const { body } = await request(server).post('/admin/User').send({ name: 'New' }).expect(201)

    expect(body.data.bio).toBe('set by the hook')
  })

  it('is given the model and the request context', async () => {
    const beforeCreate = vi.fn(({ data }: { data: Record<string, unknown> }) => data)
    const server = await boot({ hooks: { User: { beforeCreate } } })

    await request(server).post('/admin/User').send({ name: 'New' }).expect(201)

    const args = beforeCreate.mock.calls[0]?.[0] as unknown as {
      model: string
      context: ExecutionContext
    }
    expect(args.model).toBe('User')
    // The same accessor as AdminAuth and AdminResourceAuth, so one works for all.
    expect(typeof args.context.switchToHttp).toBe('function')
  })

  it('runs after authorization, so a refused request never reaches it', async () => {
    const beforeCreate = vi.fn(({ data }: { data: Record<string, unknown> }) => data)
    const server = await boot({
      hooks: { User: { beforeCreate } },
      resourceAuth: { authorize: ({ operation }) => operation !== 'create' },
    })

    await request(server).post('/admin/User').send({ name: 'New' }).expect(403)

    expect(beforeCreate).not.toHaveBeenCalled()
  })

  it('cannot write a field the admin refuses', async () => {
    // A hook is application code, and the rule that a read-only field is not
    // writable is not one it should be able to step around by accident.
    const server = await boot({
      hooks: { User: { beforeCreate: ({ data }) => ({ ...data, id: 'chosen-by-the-hook' }) } },
    })

    const { body } = await request(server).post('/admin/User').send({ name: 'New' }).expect(400)

    expect(body.error.code).toBe('FIELD_NOT_FOUND')
  })

  it('sees the patch on update, not the whole record', async () => {
    const beforeUpdate = vi.fn(({ data }: { data: Record<string, unknown> }) => data)
    const server = await boot({ hooks: { User: { beforeUpdate } } })

    await request(server).patch('/admin/User/u1').send({ name: 'Changed' }).expect(200)

    expect(beforeUpdate.mock.calls[0]?.[0]).toMatchObject({ data: { name: 'Changed' }, id: 'u1' })
  })

  it('runs the after hook with the stored record', async () => {
    const afterCreate = vi.fn()
    const server = await boot({ hooks: { User: { afterCreate } } })

    await request(server).post('/admin/User').send({ name: 'New' }).expect(201)

    expect(afterCreate.mock.calls[0]?.[0]).toMatchObject({
      model: 'User',
      record: { name: 'New' },
    })
  })

  it('can refuse a deletion, with a reason the caller reads', async () => {
    const server = await boot({
      hooks: {
        User: {
          beforeDelete: () => {
            throw new ValidationError('This account has unsettled invoices.')
          },
        },
      },
    })

    const { body } = await request(server).delete('/admin/User/u1').expect(400)

    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toBe('This account has unsettled invoices.')
    // Refused, not merely reported.
    await request(server).get('/admin/User/u1').expect(200)
  })

  it('withholds the message when a hook breaks rather than objects', async () => {
    // A thrown Error is a bug, and its message may carry a connection string.
    const server = await boot({
      hooks: {
        User: {
          beforeCreate: () => {
            throw new Error('connect ECONNREFUSED 10.0.0.5:5432')
          },
        },
      },
    })

    const { body, text } = await request(server).post('/admin/User').send({ name: 'x' }).expect(500)

    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(text).not.toContain('ECONNREFUSED')
  })

  it('leaves a model without hooks alone', async () => {
    const server = await boot({ hooks: { User: { beforeCreate: ({ data }) => data } } })

    await request(server).post('/admin/Post').send({ title: 'x', authorId: 'u1' }).expect(201)
  })
})

describe('actions', () => {
  const ban: AdminAction = {
    name: 'ban',
    label: 'Ban',
    scope: 'record',
    danger: true,
    confirm: 'Ban this user?',
    run: ({ id }) => ({ message: `Banned ${String(id)}.` }),
  }

  const purge: AdminAction = {
    name: 'purge',
    label: 'Purge',
    scope: 'list',
    run: () => ({ message: 'Purged.' }),
  }

  it('appears in the metadata, with what the interface needs to draw it', async () => {
    const { body } = await request(await boot({ actions: { User: [ban, purge] } }))
      .get('/admin/meta')
      .expect(200)

    const user = body.data.models.find((model: { name: string }) => model.name === 'User')
    expect(user.actions).toEqual([
      { name: 'ban', label: 'Ban', scope: 'record', confirm: 'Ban this user?', danger: true },
      { name: 'purge', label: 'Purge', scope: 'list' },
    ])
  })

  it('is an empty list for a model with none', async () => {
    const { body } = await request(await boot({ actions: { User: [ban] } }))
      .get('/admin/meta')
      .expect(200)

    const post = body.data.models.find((model: { name: string }) => model.name === 'Post')
    expect(post.actions).toEqual([])
  })

  it('runs, and reports what it did', async () => {
    const { body } = await request(await boot({ actions: { User: [ban] } }))
      .post('/admin/actions/User/ban/u1')
      .expect(201)

    expect(body.data.message).toBe('Banned u1.')
  })

  it('runs a list action without an id', async () => {
    const { body } = await request(await boot({ actions: { User: [purge] } }))
      .post('/admin/actions/User/purge')
      .expect(201)

    expect(body.data.message).toBe('Purged.')
  })

  it('refuses a request that does not match the declared scope', async () => {
    const server = await boot({ actions: { User: [ban, purge] } })

    await request(server).post('/admin/actions/User/ban').expect(400)
    await request(server).post('/admin/actions/User/purge/u1').expect(400)
  })

  it('404s for a model that is not exposed, 400 for an action that does not exist', async () => {
    const server = await boot({ actions: { User: [ban] } })

    await request(server).post('/admin/actions/Nope/ban/u1').expect(404)
    await request(server).post('/admin/actions/User/nope/u1').expect(400)
  })

  it('is authorized as its own operation, not as an update', async () => {
    // An action can do anything, so a policy should be able to decide about it
    // separately - and one written before actions existed denies the value it
    // does not recognise, which is the right direction to fail in.
    const server = await boot({
      actions: { User: [ban] },
      resourceAuth: { authorize: ({ operation }) => operation !== 'action' },
    })

    await request(server).post('/admin/actions/User/ban/u1').expect(403)
    // Updating is still permitted, so the two are genuinely separate.
    await request(server).patch('/admin/User/u1').send({ name: 'x' }).expect(200)
  })

  it('is absent from the metadata when the policy refuses it', async () => {
    const { body } = await request(
      await boot({
        actions: { User: [ban] },
        resourceAuth: { authorize: ({ operation }) => operation !== 'action' },
      }),
    )
      .get('/admin/meta')
      .expect(200)

    expect(body.data.models[0].actions).toEqual([])
  })

  it('forwards a ValidationError message and withholds anything else', async () => {
    const server = await boot({
      actions: {
        User: [
          {
            name: 'refuse',
            scope: 'list',
            run: () => {
              throw new ValidationError('Nothing to purge.')
            },
          },
          {
            name: 'break',
            scope: 'list',
            run: () => {
              throw new Error('secret internal detail')
            },
          },
        ],
      },
    })

    const refused = await request(server).post('/admin/actions/User/refuse').expect(400)
    expect(refused.body.error.message).toBe('Nothing to purge.')

    const broken = await request(server).post('/admin/actions/User/break').expect(500)
    expect(broken.text).not.toContain('secret internal detail')
  })

  it('does not shadow the model routes it sits beside', async () => {
    // `actions` is a reserved first segment, matched before `:model`. The
    // ordinary routes have to keep working.
    const server = await boot({ actions: { User: [ban] } })

    await request(server).get('/admin/User').expect(200)
    await request(server).post('/admin/User/u1/posts').send({ id: 'p1' }).expect(201)
  })
})

describe('theme', () => {
  const shellOf = async (theme: AdminTheme) =>
    (
      await request(await boot({ theme }))
        .get('/admin')
        .expect(200)
    ).text

  it('reaches the page as a CSS variable and a global', async () => {
    const shell = await shellOf({ brandColor: '#0b6e6e', title: 'Ops', logoUrl: 'https://x/y.png' })

    expect(shell).toContain('--brand:#0b6e6e')
    expect(shell).toContain('<title>Ops</title>')
    expect(shell).toContain('"logoUrl":"https://x/y.png"')
  })

  it('changes nothing when unset', async () => {
    const shell = (
      await request(await boot({}))
        .get('/admin')
        .expect(200)
    ).text

    expect(shell).not.toContain('__NEST_ADMIN_THEME__')
  })

  for (const [option, value] of [
    ['brandColor', 'red; } body { display: none'],
    ['title', '</title><script>alert(1)</script>'],
    ['logoUrl', 'javascript:alert(1)'],
  ] as const) {
    it(`refuses a ${option} that could carry markup or script`, () => {
      // The values come from configuration rather than a request, so this is
      // not the usual injection boundary - but a template that interpolates
      // unchecked strings is a mistake waiting for the first value read from a
      // database or an environment variable.
      expect(() =>
        AdminModule.forRoot({
          adapter: new InMemoryAdapter(seed()),
          auth: unsafeAllowAllRequests(),
          uiRoot: BUILT_UI_ROOT,
          theme: { [option]: value } as AdminTheme,
        }),
      ).toThrow(new RegExp(option))
    })
  }
})
