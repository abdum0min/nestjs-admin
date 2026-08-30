/**
 * Which providers are told to ignore capitalisation.
 *
 * The integration suite runs on SQLite, where `LIKE` already ignores case for
 * ASCII, so it cannot tell a query that asked for case-insensitivity from one
 * that got it for free. What it also cannot do is prove the option is *absent*
 * where Prisma would throw on it - and that is the failure mode worth guarding,
 * because it takes out every search on the provider rather than degrading one.
 */
import { describe, expect, it } from 'vitest'

import type { ModelMetadata } from '@nest-admin/core'

import { buildWhere, insensitively } from '../src/query/to-prisma-args.js'

const MODEL: ModelMetadata = {
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  fields: [
    {
      name: 'id',
      kind: 'string',
      isId: true,
      isRequired: true,
      isUnique: true,
      isList: false,
      isGenerated: true,
    },
    {
      name: 'name',
      kind: 'string',
      isId: false,
      isRequired: true,
      isUnique: false,
      isList: false,
      isGenerated: false,
    },
  ],
}

describe('insensitively', () => {
  it('sends the option where Prisma accepts it', () => {
    expect(insensitively('postgresql')).toEqual({ mode: 'insensitive' })
    expect(insensitively('mongodb')).toEqual({ mode: 'insensitive' })
  })

  it('sends nothing where the collation already ignores case', () => {
    // Sending it anyway is not a no-op: Prisma rejects the query outright.
    expect(insensitively('sqlite')).toEqual({})
    expect(insensitively('mysql')).toEqual({})
    expect(insensitively('sqlserver')).toEqual({})
  })

  it('sends nothing where support is unproven', () => {
    // Prisma documents `mode` for PostgreSQL and MongoDB. This is not the
    // place to guess about the rest.
    expect(insensitively('cockroachdb')).toEqual({})
    expect(insensitively('somethingnew')).toEqual({})
  })

  it('sends nothing when the provider could not be read', () => {
    // An unreadable schema degrades to the previous behaviour, never to a
    // panel whose every search fails.
    expect(insensitively(undefined)).toEqual({})
  })
})

describe('the query it produces', () => {
  it('marks a search insensitive on PostgreSQL', () => {
    expect(buildWhere(MODEL, { search: 'ada' }, 'postgresql')).toEqual({
      OR: [{ name: { contains: 'ada', mode: 'insensitive' } }],
    })
  })

  it('leaves the search alone on SQLite', () => {
    expect(buildWhere(MODEL, { search: 'ada' }, 'sqlite')).toEqual({
      OR: [{ name: { contains: 'ada' } }],
    })
  })

  it('marks the textual filter operators and no others', () => {
    const where = (operator: string, value: unknown) =>
      buildWhere(MODEL, { filters: [{ field: 'name', operator, value } as never] }, 'postgresql')

    expect(where('contains', 'a')).toEqual({ name: { contains: 'a', mode: 'insensitive' } })
    expect(where('startsWith', 'a')).toEqual({ name: { startsWith: 'a', mode: 'insensitive' } })
    expect(where('endsWith', 'a')).toEqual({ name: { endsWith: 'a', mode: 'insensitive' } })
    // An exact match is not a text search, and `in` takes a list.
    expect(where('eq', 'a')).toEqual({ name: { equals: 'a' } })
    expect(where('in', ['a', 'b'])).toEqual({ name: { in: ['a', 'b'] } })
  })
})
