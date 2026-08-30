/**
 * Loading to-one relations.
 *
 * Against the real fixture database, because the point of this code is the
 * shape of the SQL Prisma builds - a unit test with a stubbed client would
 * assert the arguments and prove nothing about the result.
 */
import { displayFieldFor, type ModelMetadata } from '@nest-admin/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { PrismaAdapter } from '../src/adapter.js'
import { toIncludeClause } from '../src/query/to-include.js'
import {
  createCountingTestClient,
  createTestClient,
  FIXTURE_SCHEMA_PATH,
  resetDatabase,
} from './client.js'

const client = createTestClient()
const adapter = new PrismaAdapter({ client, schemaPath: FIXTURE_SCHEMA_PATH })

let models: readonly ModelMetadata[]
let authorId: string

beforeAll(async () => {
  models = await adapter.getModels()
})

afterAll(async () => {
  await client.$disconnect()
})

beforeEach(async () => {
  await resetDatabase(client)
  const author = await adapter.create('User', { email: 'ada@example.com', name: 'Ada Lovelace' })
  authorId = author['id'] as string
  await adapter.create('Post', { title: 'On the Analytical Engine', authorId })
})

const model = (name: string) => models.find((candidate) => candidate.name === name) as ModelMetadata

describe('the include clause', () => {
  it('covers the to-one relations a model owns', () => {
    expect(toIncludeClause(model('Post'), models)).toEqual({
      author: { select: { id: true, name: true } },
    })
  })

  it('selects the primary key and the display field, and nothing else', () => {
    // `include: { author: true }` would attach every column of the related
    // record to every row - a User's whole row, published by listing Post.
    const clause = toIncludeClause(model('Post'), models)

    expect(Object.keys(clause!['author']!.select).sort()).toEqual(['id', 'name'])
    expect(displayFieldFor(model('User'))).toBe('name')
  })

  it('is undefined for a model that owns none', () => {
    // User has `posts`, but the column is on Post.
    expect(toIncludeClause(model('User'), models)).toBeUndefined()
    expect(toIncludeClause(model('Product'), models)).toBeUndefined()
  })

  it('skips a relation whose target is not in the given set', () => {
    // The target may have been excluded from the admin. Guessing a column name
    // would produce a Prisma error that blames the schema.
    const withoutUser = models.filter((candidate) => candidate.name !== 'User')

    expect(toIncludeClause(model('Post'), withoutUser)).toBeUndefined()
  })
})

describe('listing records that have a to-one relation', () => {
  it('resolves the relation to something readable', async () => {
    const page = await adapter.list('Post', {})

    expect(page.data[0]).toMatchObject({
      title: 'On the Analytical Engine',
      authorId,
      author: { id: authorId, name: 'Ada Lovelace' },
    })
  })

  it('returns only the two selected columns of the related record', async () => {
    const page = await adapter.list('Post', {})

    // Not `email`, not `role`, not `createdAt`.
    expect(Object.keys(page.data[0]!['author'] as object).sort()).toEqual(['id', 'name'])
  })

  it('keeps the foreign key alongside it, so a form has something to submit', async () => {
    const page = await adapter.list('Post', {})

    expect(page.data[0]!['authorId']).toBe(authorId)
  })

  it('costs the same number of queries whatever the row count', async () => {
    // The N+1 this exists to avoid, measured rather than asserted from the
    // shape of the results - which look identical either way.
    const counting = createCountingTestClient()
    const measured = new PrismaAdapter({ client: counting, schemaPath: FIXTURE_SCHEMA_PATH })

    let queries = 0
    // @ts-expect-error - the event map is not in the generated client's types
    counting.$on('query', () => {
      queries += 1
    })

    const count = async (rows: number): Promise<number> => {
      await resetDatabase(counting)
      const author = await measured.create('User', { email: 'a@b.c', name: 'Ada' })
      for (let index = 0; index < rows; index += 1) {
        await measured.create('Post', { title: `Post ${index}`, authorId: author['id'] as string })
      }

      queries = 0
      const page = await measured.list('Post', { perPage: 50 })
      expect(page.data).toHaveLength(rows)
      expect(page.data.every((row) => (row['author'] as { name: string }).name === 'Ada')).toBe(
        true,
      )
      return queries
    }

    const forOne = await count(1)
    const forThirty = await count(30)

    expect(forThirty).toBe(forOne)

    await counting.$disconnect()
  })

  it('does not load to-many relations', async () => {
    // Unbounded, and one include per row would make a list page cost an
    // unpredictable amount. They arrive paginated in 0.4.0.
    const page = await adapter.list('User', {})

    expect(page.data[0]).not.toHaveProperty('posts')
  })
})

describe('reading one record', () => {
  it('resolves the relation the same way', async () => {
    const [post] = (await adapter.list('Post', {})).data
    const found = await adapter.findOne('Post', post!['id'] as string)

    expect(found).toMatchObject({ author: { id: authorId, name: 'Ada Lovelace' } })
  })
})

describe('filtering by a relation', () => {
  it('accepts the relation name and means the foreign key', async () => {
    const other = await adapter.create('User', { email: 'alan@example.com', name: 'Alan Turing' })
    await adapter.create('Post', {
      title: 'On Computable Numbers',
      authorId: other['id'] as string,
    })

    const byRelation = await adapter.list('Post', {
      filters: [{ field: 'author', operator: 'eq', value: authorId }],
    })
    const byKey = await adapter.list('Post', {
      filters: [{ field: 'authorId', operator: 'eq', value: authorId }],
    })

    expect(byRelation.total).toBe(1)
    expect(byRelation.data[0]!['title']).toBe('On the Analytical Engine')
    // Two spellings of one query.
    expect(byRelation.data).toEqual(byKey.data)
  })

  it('refuses to sort by one, rather than ordering by an opaque key', async () => {
    // It would run. `authorId` is a cuid, so the result would look sorted and
    // mean nothing - and what the caller wanted was the author's name.
    await expect(
      adapter.list('Post', { sort: [{ field: 'author', direction: 'asc' }] }),
    ).rejects.toThrow(/Sorting by a relation is not supported/)
  })

  it('still refuses a to-many relation, which has no key here', async () => {
    await expect(
      adapter.list('User', { filters: [{ field: 'posts', operator: 'eq', value: 'x' }] }),
    ).rejects.toThrow(/Relation fields cannot be filtered/)
  })
})

describe('free-text search', () => {
  it('does not match against foreign keys', async () => {
    // A cuid is a string column that is not generated, so the existing
    // exclusion for generated ids missed it. Searching for a letter that the
    // author's id contains used to return the post.
    const letter = authorId.slice(4, 6)

    const page = await adapter.list('Post', { search: letter })

    expect(page.data.every((row) => (row['title'] as string).includes(letter))).toBe(true)
  })

  it('still matches the fields a person would search', async () => {
    const page = await adapter.list('Post', { search: 'Analytical' })

    expect(page.total).toBe(1)
  })
})

describe('writing', () => {
  it('sets the relation through the foreign key', async () => {
    const other = await adapter.create('User', { email: 'alan@example.com', name: 'Alan Turing' })

    const [post] = (await adapter.list('Post', {})).data
    const updated = await adapter.update('Post', post!['id'] as string, {
      authorId: other['id'] as string,
    })

    expect(updated['authorId']).toBe(other['id'])
  })
})
