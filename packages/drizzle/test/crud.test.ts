/**
 * The adapter against a real database.
 *
 * Every assertion here has a counterpart in the Prisma adapter's suite, because
 * the contract promises the same behaviour whichever ORM is underneath. Where
 * an assertion has no counterpart, it is testing something Drizzle made this
 * adapter responsible for and Prisma did not - those are marked.
 */
import {
  AdapterError,
  ConstraintError,
  FieldNotFoundError,
  InvalidQueryError,
  ModelNotFoundError,
  RecordNotFoundError,
} from '@nest-admin/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DrizzleAdapter } from '../src/index.js'
import { seeded } from './database.js'

let adapter: DrizzleAdapter
let close: () => void

beforeEach(() => {
  const database = seeded()
  adapter = database.adapter
  close = database.close
})

afterEach(() => close())

describe('list', () => {
  it('pages, and reports the total beyond the page', async () => {
    const page = await adapter.list('users', { page: 1, perPage: 2 })
    expect(page.data).toHaveLength(2)
    expect(page).toMatchObject({ total: 3, page: 1, perPage: 2 })
  })

  it('clamps a page size above the ceiling rather than refusing it', async () => {
    expect((await adapter.list('users', { perPage: 5000 })).perPage).toBe(100)
  })

  it('sorts, in both directions', async () => {
    const down = await adapter.list('posts', { sort: [{ field: 'views', direction: 'desc' }] })
    expect(down.data.map((row) => row['views'])).toEqual([10, 5, 1])

    const up = await adapter.list('posts', { sort: [{ field: 'views', direction: 'asc' }] })
    expect(up.data.map((row) => row['views'])).toEqual([1, 5, 10])
  })

  it('filters with every operator', async () => {
    const only = async (filter: Parameters<typeof adapter.list>[1]) =>
      (await adapter.list('users', filter)).data.map((row) => row['name'])

    expect(await only({ filters: [{ field: 'age', operator: 'gt', value: 36 }] })).toEqual(['Bob'])
    expect(await only({ filters: [{ field: 'age', operator: 'gte', value: 36 }] })).toHaveLength(2)
    expect(await only({ filters: [{ field: 'name', operator: 'eq', value: 'Ada' }] })).toEqual([
      'Ada',
    ])
    expect(await only({ filters: [{ field: 'name', operator: 'ne', value: 'Ada' }] })).toHaveLength(
      2,
    )
    expect(await only({ filters: [{ field: 'active', operator: 'eq', value: false }] })).toEqual([
      'Bob',
    ])
    expect(await only({ filters: [{ field: 'role', operator: 'in', value: ['ADMIN'] }] })).toEqual([
      'Ada',
    ])
    expect(
      await only({ filters: [{ field: 'email', operator: 'startsWith', value: 'ada' }] }),
    ).toEqual(['Ada'])
    expect(
      await only({ filters: [{ field: 'email', operator: 'endsWith', value: 'example.com' }] }),
    ).toHaveLength(3)
  })

  it('ignores case in contains, on a dialect with no insensitive mode', async () => {
    // Prisma has `mode: 'insensitive'` on some providers. Drizzle has `ilike`
    // on Postgres only, so this adapter lowercases both sides - and that has to
    // actually work, not merely compile.
    const page = await adapter.list('users', {
      filters: [{ field: 'name', operator: 'contains', value: 'ADA' }],
    })
    expect(page.data.map((row) => row['name'])).toEqual(['Ada'])
  })

  it('treats % and _ in a filter as text, not as wildcards', async () => {
    // Prisma escapes these. Building the LIKE pattern by hand means this
    // adapter must, or a search for "100%" matches every row.
    const percent = await adapter.list('users', {
      filters: [{ field: 'name', operator: 'contains', value: '100%' }],
    })
    expect(percent.data.map((row) => row['name'])).toEqual(['Cy 100%'])

    const underscore = await adapter.list('users', {
      filters: [{ field: 'bio', operator: 'contains', value: '_underscores_' }],
    })
    expect(underscore.data).toHaveLength(1)

    // The wildcard reading would have matched everything.
    const literal = await adapter.list('users', {
      filters: [{ field: 'name', operator: 'contains', value: '%' }],
    })
    expect(literal.data).toHaveLength(1)
  })

  it('combines filters and search', async () => {
    const page = await adapter.list('users', {
      search: 'example.com',
      filters: [{ field: 'active', operator: 'eq', value: true }],
    })
    expect(page.data.map((row) => row['name']).sort()).toEqual(['Ada', 'Cy 100%'])
  })

  it('searches text columns but not foreign keys or generated ones', async () => {
    // `posts.authorId` holds an opaque id. Searching it would make a one-letter
    // search match nearly every row of any model that references another.
    const page = await adapter.list('posts', { search: 'u1' })
    expect(page.data).toHaveLength(0)
  })

  it('filters a to-one relation by its foreign key', async () => {
    const page = await adapter.list('posts', {
      filters: [{ field: 'author', operator: 'eq', value: 'u1' }],
    })
    expect(page.data.map((row) => row['title']).sort()).toEqual(['First', 'Second'])
  })

  it('parses a date filter into a date', async () => {
    // The HTTP layer coerces by kind but produces JSON, and a Drizzle timestamp
    // column expects a Date. Comparing against the ISO string would read back
    // as an invalid date rather than as an error.
    const page = await adapter.list('users', {
      filters: [
        {
          field: 'createdAt',
          operator: 'gte',
          value: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        },
      ],
    })
    expect(page.data.map((row) => row['name']).sort()).toEqual(['Ada', 'Bob'])
  })
})

describe('what a query may not address', () => {
  it('refuses an unknown field', async () => {
    await expect(
      adapter.list('users', { filters: [{ field: 'nope', operator: 'eq', value: 1 }] }),
    ).rejects.toBeInstanceOf(FieldNotFoundError)
  })

  it('refuses a text operator on a number', async () => {
    await expect(
      adapter.list('users', { filters: [{ field: 'age', operator: 'contains', value: '3' }] }),
    ).rejects.toBeInstanceOf(InvalidQueryError)
  })

  it('refuses a comparison on a boolean', async () => {
    await expect(
      adapter.list('users', { filters: [{ field: 'active', operator: 'gt', value: true }] }),
    ).rejects.toBeInstanceOf(InvalidQueryError)
  })

  it('refuses in without an array', async () => {
    await expect(
      adapter.list('users', { filters: [{ field: 'role', operator: 'in', value: 'ADMIN' }] }),
    ).rejects.toBeInstanceOf(InvalidQueryError)
  })

  it('refuses to sort by a relation, and says why', async () => {
    await expect(
      adapter.list('posts', { sort: [{ field: 'author', direction: 'asc' }] }),
    ).rejects.toThrow(/opaque key/)
  })

  it('refuses an unknown model', async () => {
    await expect(adapter.list('nope', {})).rejects.toBeInstanceOf(ModelNotFoundError)
  })
})

describe('reading and writing one record', () => {
  it('finds one, and returns null rather than throwing when absent', async () => {
    expect(await adapter.findOne('users', 'u1')).toMatchObject({ name: 'Ada' })
    expect(await adapter.findOne('users', 'nobody')).toBeNull()
  })

  it('creates, and returns the stored row rather than the submitted data', async () => {
    // The difference is the defaults: `role`, `active` and `createdAt` were not
    // submitted and must come back filled in.
    const created = await adapter.create('users', {
      id: 'u9',
      email: 'new@example.com',
      name: 'New',
    })

    expect(created).toMatchObject({ id: 'u9', name: 'New', role: 'USER', active: true })
    expect(created['createdAt']).toBeInstanceOf(Date)
  })

  it('accepts a date as an ISO string on the way in', async () => {
    const created = await adapter.create('users', {
      id: 'u8',
      email: 'dated@example.com',
      createdAt: '2024-03-04T05:06:07.000Z',
    })
    expect((created['createdAt'] as Date).toISOString()).toBe('2024-03-04T05:06:07.000Z')
  })

  it('updates and returns the new row', async () => {
    expect(await adapter.update('users', 'u1', { name: 'Ada L.' })).toMatchObject({
      name: 'Ada L.',
    })
  })

  it('reports a missing row on update rather than updating nothing', async () => {
    // Drizzle updates zero rows and says nothing; Prisma raises P2025. The
    // contract expects the second, so the adapter produces it.
    await expect(adapter.update('users', 'nobody', { name: 'x' })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    )
  })

  it('treats an update with nothing to set as a read', async () => {
    // Every dialect rejects `SET` with no assignments, and the admin sends an
    // empty patch whenever a form is submitted unchanged.
    expect(await adapter.update('users', 'u1', {})).toMatchObject({ name: 'Ada' })
  })

  it('deletes, and reports a missing row', async () => {
    await adapter.delete('posts', 'p3')
    expect(await adapter.findOne('posts', 'p3')).toBeNull()
    await expect(adapter.delete('posts', 'p3')).rejects.toBeInstanceOf(RecordNotFoundError)
  })

  it('refuses to write a field the model does not have', async () => {
    await expect(
      adapter.create('users', { id: 'u7', email: 'x@example.com', nope: 1 }),
    ).rejects.toBeInstanceOf(FieldNotFoundError)
  })
})

describe('what the database refuses', () => {
  it('names the column of a unique violation', async () => {
    // The driver reports `UNIQUE constraint failed: users.email` and no more.
    // The column is recovered from that, and translated back into the schema's
    // name, so the interface can put the message under the right box.
    const failure = await adapter
      .create('users', { id: 'u6', email: 'ada@example.com' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConstraintError)
    expect(failure).toMatchObject({ constraint: 'unique', fields: ['email'] })
  })

  it('names the column of a missing required value', async () => {
    const failure = await adapter
      .create('posts', { id: 'p9', title: null })
      .catch((error: unknown) => error)

    expect(failure).toMatchObject({ constraint: 'required', fields: ['title'] })
  })

  it('reports a foreign key violation as one', async () => {
    const failure = await adapter
      .create('comments', { id: 'c9', body: 'x', postId: 'nope' })
      .catch((error: unknown) => error)

    expect(failure).toMatchObject({ constraint: 'foreign-key' })
  })

  it('translates a column name back into the schema name', async () => {
    // The driver says `author_id`; every other layer says `authorId`. Reporting
    // the driver's name would point the interface at a field the form has not
    // got.
    const failure = await adapter
      .update('posts', 'p1', { authorId: 'nobody' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConstraintError)
    expect((failure as ConstraintError).fields).not.toContain('author_id')
  })
})

describe('relations', () => {
  it('lists the far side of a to-many, paginated', async () => {
    const page = await adapter.listRelated('users', 'u1', 'posts', { perPage: 1 })
    expect(page.data).toHaveLength(1)
    expect(page.total).toBe(2)
  })

  it('applies filters and sorting to a related list', async () => {
    const page = await adapter.listRelated('users', 'u1', 'posts', {
      filters: [{ field: 'published', operator: 'eq', value: true }],
    })
    expect(page.data.map((row) => row['title'])).toEqual(['First'])
  })

  it('lists through a declared relation under the declared name', async () => {
    const page = await adapter.listRelated('posts', 'p1', 'discussion', {})
    expect(page.data.map((row) => row['body']).sort()).toEqual(['Agreed', 'Nice'])
  })

  it('attaches by rewriting the child key', async () => {
    await adapter.attachRelated('users', 'u2', 'posts', 'p3')
    expect(await adapter.findOne('posts', 'p3')).toMatchObject({ authorId: 'u2' })
  })

  it('detaches by clearing it', async () => {
    await adapter.detachRelated('users', 'u1', 'posts', 'p2')
    expect(await adapter.findOne('posts', 'p2')).toMatchObject({ authorId: null })
  })

  it('refuses to list through a to-one', async () => {
    await expect(adapter.listRelated('posts', 'p1', 'author', {})).rejects.toBeInstanceOf(
      FieldNotFoundError,
    )
  })

  it('says a join table is its own resource rather than pretending to a many-to-many', async () => {
    // `posts.postTags` is a to-many onto the join table, which works. What does
    // not exist is `posts.tags`, and the error says where to look instead.
    await expect(adapter.listRelated('posts', 'p1', 'tags', {})).rejects.toBeInstanceOf(
      FieldNotFoundError,
    )
    expect((await adapter.listRelated('posts', 'p1', 'postTags', {})).total).toBe(1)
  })

  it('refuses to address a composite-keyed record by one value', async () => {
    // `postTags` has a two-column key. The contract addresses records by a
    // single id, so this is refused with a reason rather than guessing.
    await expect(adapter.findOne('postTags', 'p1')).rejects.toBeInstanceOf(AdapterError)
  })
})
