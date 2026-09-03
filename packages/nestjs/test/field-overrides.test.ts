/**
 * Per-model and per-field configuration.
 *
 * Two of these options are enforced rather than suggested, and those are what
 * most of this file is about. `hidden` exists so a password hash never leaves
 * the application; an implementation that only stopped the interface drawing it
 * would be a security hole with a reassuring name. `readOnly` is the same kind
 * of promise, one step weaker.
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
  User: [{ id: 'u1', email: '36', name: 'Ada', age: 36, active: true, role: 'ADMIN' }],
  Post: [{ id: 'p1', title: 'First', body: 'A body', authorId: 'u1' }],
})

const boot = async (models?: Parameters<typeof createAdminApp>[5]) => {
  app = await createAdminApp(
    new InMemoryAdapter(seed()),
    undefined,
    undefined,
    undefined,
    undefined,
    models,
  )
  return app.getHttpServer()
}

const userMeta = async (server: unknown) => {
  const { body } = await request(server as never)
    .get('/admin/meta')
    .expect(200)
  return body.data.models.find((model: { name: string }) => model.name === 'User')
}

describe('a hidden field', () => {
  // `age` is optional, so hiding it does not make creation impossible - see the
  // startup check at the bottom of this file.
  const hideBio = { User: { fields: { bio: { hidden: true } } } }

  it('is absent from the metadata document', async () => {
    const model = await userMeta(await boot(hideBio))

    expect(model.fields.map((field: { name: string }) => field.name)).not.toContain('bio')
  })

  it('is absent from a listed record', async () => {
    // The adapter reads whole rows - it knows nothing about this option - so
    // the value does arrive at the service. It must not get past it.
    const { body } = await request(await boot(hideBio))
      .get('/admin/User')
      .expect(200)

    expect(body.data[0]).not.toHaveProperty('bio')
    expect(JSON.stringify(body)).not.toContain('Wrote the first program')
  })

  it('is absent from a single record', async () => {
    const { body } = await request(await boot(hideBio))
      .get('/admin/User/u1')
      .expect(200)

    expect(body.data).not.toHaveProperty('bio')
  })

  it('is absent from the record a write returns', async () => {
    const server = await boot(hideBio)

    const created = await request(server).post('/admin/User').send({ name: 'New' }).expect(201)
    expect(created.body.data).not.toHaveProperty('bio')

    const updated = await request(server)
      .patch('/admin/User/u1')
      .send({ name: 'Changed' })
      .expect(200)
    expect(updated.body.data).not.toHaveProperty('bio')
  })

  it('is absent from a related record', async () => {
    // The nested route returns records of the target model, and they go
    // through the same projection.
    const { body } = await request(await boot({ Post: { fields: { body: { hidden: true } } } }))
      .get('/admin/User/u1/posts')
      .expect(200)

    expect(body.data[0]).not.toHaveProperty('body')
  })

  it('cannot be filtered or sorted by', async () => {
    // It is removed from the metadata the query parser reads, so an attempt is
    // indistinguishable from a typo - which is the intended answer.
    const server = await boot(hideBio)

    for (const query of ['?filter=bio:eq:x', '?sort=bio:asc']) {
      const { body } = await request(server).get(`/admin/User${query}`).expect(400)
      expect(body.error.code).toBe('FIELD_NOT_FOUND')
    }
  })

  it('cannot be written', async () => {
    const server = await boot(hideBio)

    const created = await request(server)
      .post('/admin/User')
      .send({ name: 'New', bio: 'sneaky' })
      .expect(400)

    expect(created.body.error.code).toBe('FIELD_NOT_FOUND')
  })

  it('is not searched by free text', async () => {
    // Otherwise a hidden column could be probed a character at a time.
    const { body } = await request(await boot(hideBio))
      .get('/admin/User?search=Wrote the first program')
      .expect(200)

    expect(body.meta.total).toBe(0)
  })

  it('leaves everything else alone', async () => {
    const model = await userMeta(await boot(hideBio))

    expect(model.fields.map((field: { name: string }) => field.name)).toContain('name')
  })
})

describe('a read-only field', () => {
  const readOnlyName = { User: { fields: { name: { readOnly: true } } } }

  it('is still shown', async () => {
    const { body } = await request(await boot(readOnlyName))
      .get('/admin/User/u1')
      .expect(200)

    expect(body.data.name).toBe('Ada')
  })

  it('is marked in the metadata', async () => {
    const model = await userMeta(await boot(readOnlyName))
    const field = model.fields.find((candidate: { name: string }) => candidate.name === 'name')

    expect(field.readOnly).toBe(true)
  })

  it('is refused in a write', async () => {
    const { body } = await request(await boot(readOnlyName))
      .patch('/admin/User/u1')
      .send({ name: 'Changed' })
      .expect(400)

    expect(body.error.code).toBe('FIELD_NOT_FOUND')
    expect(body.error.message).toMatch(/read-only/)
  })

  it('marks generated fields read-only without being told', async () => {
    const model = await userMeta(await boot())
    const id = model.fields.find((candidate: { name: string }) => candidate.name === 'id')

    expect(id.readOnly).toBe(true)
  })
})

describe('presentation', () => {
  it('carries labels and widgets through to the client', async () => {
    const model = await userMeta(
      await boot({
        User: { label: 'People', fields: { name: { label: 'Full name', widget: 'textarea' } } },
      }),
    )
    const field = model.fields.find((candidate: { name: string }) => candidate.name === 'name')

    expect(model.label).toBe('People')
    expect(field.label).toBe('Full name')
    expect(field.widget).toBe('textarea')
  })

  it('orders what was ordered and leaves the rest in schema order', async () => {
    const model = await userMeta(
      await boot({ User: { fields: { role: { order: 1 }, active: { order: 2 } } } }),
    )

    const names = model.fields.map((field: { name: string }) => field.name)
    expect(names.slice(0, 2)).toEqual(['role', 'active'])
    // Untouched fields keep their relative order.
    expect(names.indexOf('id')).toBeLessThan(names.indexOf('age'))
  })

  it('overrides the display field', async () => {
    const model = await userMeta(await boot({ User: { displayField: 'age' } }))

    expect(model.displayField).toBe('age')
  })
})

describe('a name that matches nothing', () => {
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

  it('fails at startup for an unknown model', async () => {
    await expect(bootWith({ Nope: { label: 'x' } })).rejects.toThrow(/Nope/)
  })

  it('fails at startup for an unknown field', async () => {
    // The cost of ignoring this is not symmetrical: a mistyped `hidden` leaves
    // the real column exposed while the configuration looks protective.
    await expect(
      bootWith({ User: { fields: { passwordHash: { hidden: true } } } }),
    ).rejects.toThrow(/User\.passwordHash/)
  })

  it('says why it is an error rather than a warning', async () => {
    await expect(bootWith({ User: { fields: { nope: { hidden: true } } } })).rejects.toThrow(
      /leaves the real column exposed/,
    )
  })

  it('fails for an unknown display field', async () => {
    await expect(bootWith({ User: { displayField: 'nope' } })).rejects.toThrow(/User\.nope/)
  })
})

describe('hiding a field that must be supplied', () => {
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

  it('fails at startup, because every create would fail in the database', async () => {
    // Found by hiding a required column in a real consumer: creates began
    // returning 500 from a constraint violation, with nothing pointing at the
    // configuration that caused it.
    await expect(bootWith({ User: { fields: { email: { hidden: true } } } })).rejects.toThrow(
      /User\.email/,
    )
  })

  it('says what to do about it', async () => {
    await expect(bootWith({ User: { fields: { email: { hidden: true } } } })).rejects.toThrow(
      /Give the column a default, make it optional, or leave it visible/,
    )
  })

  it('allows hiding an optional field', async () => {
    await expect(bootWith({ User: { fields: { age: { hidden: true } } } })).resolves.toBeUndefined()
  })

  it('allows hiding a field with a default, which the database can supply', async () => {
    await expect(
      bootWith({ User: { fields: { active: { hidden: true } } } }),
    ).resolves.toBeUndefined()
  })

  it('allows hiding a generated field', async () => {
    await expect(bootWith({ User: { fields: { id: { hidden: true } } } })).resolves.toBeUndefined()
  })
})

describe('a placeholder picture', () => {
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

  it('reaches the interface, which is the only layer that draws it', async () => {
    const model = await userMeta(
      await boot({
        User: { fields: { avatarUrl: { widget: 'image', placeholder: '/img/avatar.png' } } },
      } as never),
    )

    const field = model.fields.find((candidate: { name: string }) => candidate.name === 'avatarUrl')
    expect(field.placeholder).toBe('/img/avatar.png')
  })

  it('is absent unless it was configured', async () => {
    const model = await userMeta(await boot())
    for (const field of model.fields) expect(field.placeholder).toBeUndefined()
  })

  it('refuses a relative path at startup', async () => {
    // The admin is one hash-routed page: `img/avatar.png` resolves against
    // whatever route is open, so the same value loads on the list screen and
    // 404s on a detail page. The symptom is a default avatar that appears and
    // disappears as you navigate, which reads as a caching fault.
    await expect(
      bootWith({ User: { fields: { avatarUrl: { placeholder: 'img/avatar.png' } } } }),
    ).rejects.toThrow(/placeholder/)
  })

  it('says what a usable one looks like', async () => {
    await expect(
      bootWith({ User: { fields: { avatarUrl: { placeholder: 'img/avatar.png' } } } }),
    ).rejects.toThrow(/"\/img\/avatar\.png" or a full URL/)
  })

  it('accepts a URL, a rooted path and a data URI', async () => {
    for (const placeholder of [
      'https://cdn.example.com/avatar.png',
      '//cdn.example.com/avatar.png',
      '/img/avatar.png',
      'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
    ]) {
      await expect(
        bootWith({ User: { fields: { avatarUrl: { placeholder } } } }),
      ).resolves.toBeUndefined()
      await app?.close()
      app = undefined
    }
  })
})
