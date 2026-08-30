/**
 * Integration tests for PrismaAdapter against a real SQLite database.
 *
 * Nothing is mocked: a real generated Prisma Client talks to a real file-backed
 * database. Faking the client here would only prove that our own stubs match
 * our own expectations, which is precisely the bug class these tests exist to
 * catch.
 */
import {
  ConstraintError,
  FieldNotFoundError,
  InvalidQueryError,
  ModelNotFoundError,
  RecordNotFoundError,
  type RecordData,
} from '@nest-admin/core'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { PrismaAdapter } from '../src/adapter.js'
import { createTestClient, FIXTURE_SCHEMA_PATH, resetDatabase } from './client.js'

const client = createTestClient()
const adapter = new PrismaAdapter({ client, schemaPath: FIXTURE_SCHEMA_PATH })

beforeEach(async () => {
  await resetDatabase(client)
})

afterAll(async () => {
  await client.$disconnect()
})

async function seedUser(overrides: RecordData = {}): Promise<RecordData> {
  return adapter.create('User', {
    email: `user-${Math.random().toString(36).slice(2)}@example.com`,
    name: 'Ada',
    ...overrides,
  })
}

describe('create', () => {
  it('creates a record and returns it', async () => {
    const created = await adapter.create('User', { email: 'ada@example.com', name: 'Ada' })

    expect(created['email']).toBe('ada@example.com')
    expect(created['name']).toBe('Ada')
  })

  it('lets the database fill generated fields', async () => {
    const created = await adapter.create('User', { email: 'gen@example.com', name: 'Gen' })

    expect(typeof created['id']).toBe('string')
    expect(created['id']).not.toBe('')
    expect(created['createdAt']).toBeInstanceOf(Date)
    expect(created['updatedAt']).toBeInstanceOf(Date)
  })

  it('applies schema defaults when the field is omitted', async () => {
    const created = await adapter.create('User', { email: 'def@example.com', name: 'Def' })

    expect(created['active']).toBe(true) // @default(true)
    expect(created['role']).toBe('USER') // @default(USER)
  })

  it('accepts an explicit value for a field that has a literal default', async () => {
    const created = await adapter.create('User', {
      email: 'admin@example.com',
      name: 'Admin',
      active: false,
      role: 'ADMIN',
    })

    expect(created['active']).toBe(false)
    expect(created['role']).toBe('ADMIN')
  })

  it('rejects unknown fields rather than silently dropping them', async () => {
    await expect(
      adapter.create('User', { email: 'x@example.com', name: 'X', nope: 1 }),
    ).rejects.toThrow(FieldNotFoundError)
  })

  it('rejects writing a relation field', async () => {
    await expect(
      adapter.create('User', { email: 'r@example.com', name: 'R', posts: [] }),
    ).rejects.toThrow(FieldNotFoundError)
  })

  it('reports a duplicate value as a constraint error naming the field', async () => {
    await adapter.create('User', { email: 'dupe@example.com', name: 'One' })

    // The unique constraint on email is enforced by the database, not by us.
    const failure = await adapter
      .create('User', { email: 'dupe@example.com', name: 'Two' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConstraintError)
    expect(failure).toMatchObject({ constraint: 'unique', model: 'User', fields: ['email'] })
    // Written here from the field name, never taken from Prisma's own text.
    expect((failure as Error).message).toBe('Another User already has this email.')
    expect((failure as Error).message).not.toMatch(/prisma/i)
  })

  it('reports a missing required value as a constraint error', async () => {
    // This one never reaches the database: Prisma refuses it as a
    // `PrismaClientValidationError`, which carries no code, so it arrives by a
    // different route than every other constraint here.
    const failure = await adapter
      .create('User', { name: 'Nameless' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConstraintError)
    expect(failure).toMatchObject({ constraint: 'required', model: 'User', fields: ['email'] })
    expect((failure as Error).message).toBe('email is required.')
    // That error's own text renders the call site and the submitted data.
    expect((failure as Error).message).not.toMatch(/prisma|invocation|.ts/i)
  })

  it('reports a reference to a missing record as a constraint error', async () => {
    const failure = await adapter
      .create('Post', { title: 'Orphan', authorId: 'nobody' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConstraintError)
    expect(failure).toMatchObject({ constraint: 'foreign-key', model: 'Post' })
  })
})

describe('findOne', () => {
  it('returns the record matching the id', async () => {
    const created = await seedUser({ name: 'Grace' })

    const found = await adapter.findOne('User', created['id'] as string)

    expect(found?.['id']).toBe(created['id'])
    expect(found?.['name']).toBe('Grace')
  })

  it('returns null for an id that does not exist', async () => {
    expect(await adapter.findOne('User', 'does-not-exist')).toBeNull()
  })
})

describe('update', () => {
  it('applies a partial update', async () => {
    const created = await seedUser({ name: 'Before' })

    const updated = await adapter.update('User', created['id'] as string, { name: 'After' })

    expect(updated['name']).toBe('After')
    expect(updated['email']).toBe(created['email'])
  })

  it('persists the change', async () => {
    const created = await seedUser({ name: 'Before' })
    await adapter.update('User', created['id'] as string, { name: 'After' })

    const reread = await adapter.findOne('User', created['id'] as string)
    expect(reread?.['name']).toBe('After')
  })

  it('throws RecordNotFound for a missing id', async () => {
    await expect(adapter.update('User', 'missing-id', { name: 'x' })).rejects.toThrow(
      RecordNotFoundError,
    )
  })

  it('rejects unknown fields', async () => {
    const created = await seedUser()
    await expect(adapter.update('User', created['id'] as string, { nope: true })).rejects.toThrow(
      FieldNotFoundError,
    )
  })
})

describe('delete', () => {
  it('removes the record', async () => {
    const created = await seedUser()

    await adapter.delete('User', created['id'] as string)

    expect(await adapter.findOne('User', created['id'] as string)).toBeNull()
  })

  it('throws RecordNotFound for a missing id', async () => {
    await expect(adapter.delete('User', 'missing-id')).rejects.toThrow(RecordNotFoundError)
  })
})

describe('dynamic model resolution', () => {
  it('resolves every model in the schema, not just a hardcoded one', async () => {
    const user = await adapter.create('User', { email: 'multi@example.com', name: 'Multi' })
    const product = await adapter.create('Product', { name: 'Widget', price: 9.99 })
    const post = await adapter.create('Post', {
      title: 'Hello',
      authorId: user['id'] as string,
    })

    expect(product['name']).toBe('Widget')
    expect(post['title']).toBe('Hello')
    expect((await adapter.list('Product', {})).total).toBe(1)
    expect((await adapter.list('Post', {})).total).toBe(1)
  })

  it('rejects an unknown model before touching the client', async () => {
    await expect(adapter.list('NotAModel', {})).rejects.toThrow(ModelNotFoundError)
  })

  it('names the known models in the error, so the mistake is obvious', async () => {
    await expect(adapter.list('user', {})).rejects.toThrow(
      /Known models: User, Product, Counter, Post/,
    )
  })

  it('does not let a prototype key reach the client', async () => {
    await expect(adapter.list('__proto__', {})).rejects.toThrow(ModelNotFoundError)
    await expect(adapter.list('constructor', {})).rejects.toThrow(ModelNotFoundError)
  })
})

describe('adapter construction', () => {
  it('refuses to run without a client rather than constructing one', () => {
    // Prisma 7 builds clients from driver adapters, so only the application
    // can construct one. The adapter must never do it.
    expect(() => new PrismaAdapter({ client: null })).toThrow(
      /requires a constructed Prisma Client/,
    )
  })

  it('reports a client that has no matching delegate', async () => {
    const broken = new PrismaAdapter({ client: {}, schemaPath: FIXTURE_SCHEMA_PATH })
    await expect(broken.list('User', {})).rejects.toThrow(/has no delegate "user"/)
  })
})

describe('primary keys', () => {
  it('coerces a string id to a number for an Int primary key', async () => {
    const created = await adapter.create('Counter', { label: 'hits' })
    const numericId = created['id'] as number
    expect(typeof numericId).toBe('number')

    // Ids arriving from a URL are strings. Without coercion Prisma rejects
    // the argument outright.
    const found = await adapter.findOne('Counter', String(numericId))
    expect(found?.['label']).toBe('hits')
  })

  it('rejects an unparseable id for a numeric primary key', async () => {
    await expect(adapter.findOne('Counter', 'not-a-number')).rejects.toThrow(InvalidQueryError)
  })

  it('updates and deletes through a numeric key', async () => {
    const created = await adapter.create('Counter', { label: 'before' })
    const id = String(created['id'])

    const updated = await adapter.update('Counter', id, { label: 'after' })
    expect(updated['label']).toBe('after')

    await adapter.delete('Counter', id)
    expect(await adapter.findOne('Counter', id)).toBeNull()
  })

  it('exposes a single-column primary key for every fixture model', async () => {
    const models = await adapter.getModels()
    expect(models.every((model) => model.primaryKey.length === 1)).toBe(true)
  })
})

describe('invalid payloads', () => {
  it('rejects a non-object write payload', async () => {
    await expect(adapter.create('User', null as unknown as RecordData)).rejects.toThrow(
      InvalidQueryError,
    )
  })
})
