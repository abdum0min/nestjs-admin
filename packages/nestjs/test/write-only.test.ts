/**
 * A field that is written and never read back.
 *
 * The mirror of `readOnly`, and it exists for one thing: a password has to be
 * typed into a form and must never come out of the server again. `hidden`
 * cannot express that - it refuses the field in both directions, so a hidden
 * password column leaves no way to set one. This repository's own example had
 * exactly that problem: a People resource with nowhere to put a password.
 *
 * Enforced twice on purpose. The column is left out of the query the adapter is
 * asked to make, *and* out of the projection applied to whatever comes back.
 * One is enough; two is what it takes for a future adapter that ignores the
 * field scope not to become a leak.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import { AdminModule } from '../src/module.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const seed = () => ({
  User: [{ id: 'u1', email: 'ada@example.com', name: 'Ada', bio: 'secret-value', age: 36 }],
  Post: [],
})

const boot = async (overrides: Record<string, unknown>) => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter(seed()),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        models: overrides as never,
      }),
    ],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()
  return app.getHttpServer()
}

const WRITE_ONLY = { User: { fields: { bio: { writeOnly: true } } } }

describe('reading', () => {
  it('leaves the field out of a list', async () => {
    const http = await boot(WRITE_ONLY)
    const { body } = await request(http).get('/admin/User').expect(200)

    expect(body.data[0]).not.toHaveProperty('bio')
    expect(JSON.stringify(body)).not.toContain('secret-value')
  })

  it('leaves it out of a single record', async () => {
    const http = await boot(WRITE_ONLY)
    const { body } = await request(http).get('/admin/User/u1').expect(200)

    expect(body.data).not.toHaveProperty('bio')
    expect(body.data.name).toBe('Ada')
  })

  it('leaves it out of what a write returns', async () => {
    // The one path that is easy to forget: the record echoed back after a
    // create is a read like any other.
    const http = await boot(WRITE_ONLY)
    const { body } = await request(http)
      .post('/admin/User')
      .send({ email: 'new@example.com', name: 'New', bio: 'typed-in' })
      .expect(201)

    expect(body.data).not.toHaveProperty('bio')
    expect(JSON.stringify(body)).not.toContain('typed-in')
  })
})

describe('writing', () => {
  it('accepts the field, which is the whole point', async () => {
    // `hidden` refuses it. If this were the same thing, there would be no
    // reason for both to exist.
    const http = await boot(WRITE_ONLY)

    await request(http)
      .post('/admin/User')
      .send({ email: 'new@example.com', name: 'New', bio: 'typed-in' })
      .expect(201)
  })

  it('stores what was written, even though nothing reads it back', async () => {
    // Verified through a hook, which is the only vantage point that sees the
    // data on its way in.
    let seen: unknown
    const moduleRef = await Test.createTestingModule({
      imports: [
        AdminModule.forRoot({
          adapter: new InMemoryAdapter(seed()),
          auth: unsafeAllowAllRequests(),
          uiRoot: BUILT_UI_ROOT,
          models: WRITE_ONLY as never,
          hooks: {
            User: {
              beforeCreate: ({ data }) => {
                seen = data['bio']
                return data
              },
            },
          },
        }),
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()

    await request(app.getHttpServer())
      .post('/admin/User')
      .send({ email: 'new@example.com', name: 'New', bio: 'typed-in' })
      .expect(201)

    expect(seen).toBe('typed-in')
  })
})

describe('the metadata', () => {
  it('still describes the field, so a form can offer it', async () => {
    // Unlike `hidden`, which removes it from the document entirely. A field
    // nobody can see is a field nobody can fill in.
    const http = await boot(WRITE_ONLY)
    const { body } = await request(http).get('/admin/meta').expect(200)

    const bio = body.data.models
      .find((model: { name: string }) => model.name === 'User')
      .fields.find((field: { name: string }) => field.name === 'bio')

    expect(bio).toBeDefined()
    expect(bio.writeOnly).toBe(true)
    expect(bio.readOnly).toBe(false)
  })

  it('says nothing about fields that are not write-only', async () => {
    const http = await boot(WRITE_ONLY)
    const { body } = await request(http).get('/admin/meta').expect(200)

    const name = body.data.models
      .find((model: { name: string }) => model.name === 'User')
      .fields.find((field: { name: string }) => field.name === 'name')

    expect(name).not.toHaveProperty('writeOnly')
  })
})

describe('beside hidden', () => {
  it('hidden still wins, and still refuses both directions', async () => {
    // Marking a field both is a contradiction. Removing it entirely is the
    // safer resolution: a leak is worse than a field nobody can set.
    const http = await boot({ User: { fields: { bio: { hidden: true, writeOnly: true } } } })

    const { body } = await request(http).get('/admin/User/u1').expect(200)
    expect(body.data).not.toHaveProperty('bio')

    const refused = await request(http)
      .post('/admin/User')
      .send({ email: 'x@example.com', name: 'X', bio: 'nope' })
      .expect(400)
    expect(refused.body.error.code).toBe('FIELD_NOT_FOUND')
  })
})
