/**
 * Query behaviour: pagination, sorting, filtering and search, executed against
 * the real database rather than asserted against generated Prisma arguments.
 * Testing the arguments would only restate the implementation; testing the
 * returned rows proves the translation is actually correct.
 */
import { FieldNotFoundError, InvalidQueryError } from '@nest-admin/core'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { PrismaAdapter } from '../src/adapter.js'
import { MAX_PER_PAGE } from '../src/query/to-prisma-args.js'
import { createTestClient, FIXTURE_SCHEMA_PATH, resetDatabase } from './client.js'

const client = createTestClient()
const adapter = new PrismaAdapter({ client, schemaPath: FIXTURE_SCHEMA_PATH })

const PRODUCTS = [
  { name: 'Anvil', price: 30 },
  { name: 'Bucket', price: 10 },
  { name: 'Candle', price: 20 },
  { name: 'Drill', price: 50 },
  { name: 'Ember', price: 40 },
]

beforeEach(async () => {
  await resetDatabase(client)
  for (const product of PRODUCTS) {
    await adapter.create('Product', product)
  }
})

afterAll(async () => {
  await client.$disconnect()
})

const names = (rows: readonly Record<string, unknown>[]): unknown[] => rows.map((r) => r['name'])

describe('pagination', () => {
  it('returns every row and a total by default', async () => {
    const page = await adapter.list('Product', {})

    expect(page.data).toHaveLength(5)
    expect(page.total).toBe(5)
    expect(page.page).toBe(1)
  })

  it('splits results across pages', async () => {
    const first = await adapter.list('Product', {
      page: 1,
      perPage: 2,
      sort: [{ field: 'name', direction: 'asc' }],
    })
    const second = await adapter.list('Product', {
      page: 2,
      perPage: 2,
      sort: [{ field: 'name', direction: 'asc' }],
    })

    expect(names(first.data)).toEqual(['Anvil', 'Bucket'])
    expect(names(second.data)).toEqual(['Candle', 'Drill'])
  })

  it('reports the unpaginated total alongside the page', async () => {
    const page = await adapter.list('Product', { page: 1, perPage: 2 })

    expect(page.data).toHaveLength(2)
    expect(page.total).toBe(5) // total ignores the page window
    expect(page.perPage).toBe(2)
  })

  it('returns an empty page past the end rather than failing', async () => {
    const page = await adapter.list('Product', { page: 99, perPage: 2 })

    expect(page.data).toEqual([])
    expect(page.total).toBe(5)
  })

  it('clamps an oversized perPage instead of erroring', async () => {
    const page = await adapter.list('Product', { perPage: 10_000 })

    expect(page.perPage).toBe(MAX_PER_PAGE)
  })

  it('rejects a nonsensical page number', async () => {
    await expect(adapter.list('Product', { page: 0 })).rejects.toThrow(InvalidQueryError)
    await expect(adapter.list('Product', { page: -1 })).rejects.toThrow(InvalidQueryError)
    await expect(adapter.list('Product', { perPage: 0 })).rejects.toThrow(InvalidQueryError)
  })
})

describe('sorting', () => {
  it('sorts ascending', async () => {
    const page = await adapter.list('Product', { sort: [{ field: 'name', direction: 'asc' }] })
    expect(names(page.data)).toEqual(['Anvil', 'Bucket', 'Candle', 'Drill', 'Ember'])
  })

  it('sorts descending', async () => {
    const page = await adapter.list('Product', { sort: [{ field: 'price', direction: 'desc' }] })
    expect(names(page.data)).toEqual(['Drill', 'Ember', 'Anvil', 'Candle', 'Bucket'])
  })

  it('rejects sorting by an unknown field', async () => {
    await expect(
      adapter.list('Product', { sort: [{ field: 'nope', direction: 'asc' }] }),
    ).rejects.toThrow(FieldNotFoundError)
  })

  it('rejects sorting by a relation field', async () => {
    await expect(
      adapter.list('Post', { sort: [{ field: 'author', direction: 'asc' }] }),
    ).rejects.toThrow(FieldNotFoundError)
  })
})

describe('filtering', () => {
  it('filters by equality', async () => {
    const page = await adapter.list('Product', {
      filters: [{ field: 'name', operator: 'eq', value: 'Anvil' }],
    })

    expect(names(page.data)).toEqual(['Anvil'])
    expect(page.total).toBe(1) // the total respects the filter
  })

  it('filters by inequality', async () => {
    const page = await adapter.list('Product', {
      filters: [{ field: 'name', operator: 'ne', value: 'Anvil' }],
    })
    expect(page.total).toBe(4)
  })

  it('filters by substring', async () => {
    const page = await adapter.list('Product', {
      filters: [{ field: 'name', operator: 'contains', value: 'ck' }],
    })
    expect(names(page.data)).toEqual(['Bucket'])
  })

  it('filters by numeric comparison', async () => {
    const page = await adapter.list('Product', {
      filters: [{ field: 'price', operator: 'gte', value: 30 }],
      sort: [{ field: 'price', direction: 'asc' }],
    })
    expect(names(page.data)).toEqual(['Anvil', 'Ember', 'Drill'])
  })

  it('filters by set membership', async () => {
    const page = await adapter.list('Product', {
      filters: [{ field: 'name', operator: 'in', value: ['Anvil', 'Drill'] }],
      sort: [{ field: 'name', direction: 'asc' }],
    })
    expect(names(page.data)).toEqual(['Anvil', 'Drill'])
  })

  it('combines multiple filters conjunctively', async () => {
    const page = await adapter.list('Product', {
      filters: [
        { field: 'price', operator: 'gte', value: 20 },
        { field: 'price', operator: 'lt', value: 40 },
      ],
      sort: [{ field: 'price', direction: 'asc' }],
    })
    expect(names(page.data)).toEqual(['Candle', 'Anvil'])
  })

  it('rejects filtering by an unknown field', async () => {
    await expect(
      adapter.list('Product', { filters: [{ field: 'nope', operator: 'eq', value: 1 }] }),
    ).rejects.toThrow(FieldNotFoundError)
  })

  it('rejects a string operator on a non-string field', async () => {
    await expect(
      adapter.list('Product', { filters: [{ field: 'price', operator: 'contains', value: 'x' }] }),
    ).rejects.toThrow(InvalidQueryError)
  })

  it('rejects a non-array value for "in"', async () => {
    await expect(
      adapter.list('Product', { filters: [{ field: 'name', operator: 'in', value: 'Anvil' }] }),
    ).rejects.toThrow(InvalidQueryError)
  })
})

describe('search', () => {
  it('matches across string fields', async () => {
    const page = await adapter.list('Product', { search: 'ndl' })
    expect(names(page.data)).toEqual(['Candle'])
  })

  it('returns nothing for a term that matches no record', async () => {
    const page = await adapter.list('Product', { search: 'zzzz' })
    expect(page.data).toEqual([])
    expect(page.total).toBe(0)
  })

  it('ignores a blank search term', async () => {
    const page = await adapter.list('Product', { search: '   ' })
    expect(page.total).toBe(5)
  })

  it('combines search with a filter', async () => {
    const page = await adapter.list('Product', {
      search: 'e',
      filters: [{ field: 'price', operator: 'gte', value: 40 }],
      sort: [{ field: 'name', direction: 'asc' }],
    })
    // 'Ember' (40) and 'Bucket' (10) both contain 'e'; only Ember passes the filter.
    expect(names(page.data)).toEqual(['Ember'])
  })

  it('does not match against opaque generated ids', async () => {
    // Product ids are cuids. Searching a single letter must not match a
    // record just because its random id happens to contain that letter.
    const page = await adapter.list('Product', { search: 'e' })
    expect(names(page.data).sort()).toEqual(['Bucket', 'Candle', 'Ember'])
  })
})
