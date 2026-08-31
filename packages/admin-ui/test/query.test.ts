/**
 * Query-string construction.
 *
 * The server splits `sort` and `filter` on colons and never parses brackets,
 * so a regression here would silently produce requests it misreads rather than
 * rejects. These assertions are on the exact wire format for that reason.
 */
import { describe, expect, it } from 'vitest'

import { buildQueryString } from '../src/api/query.js'

describe('pagination', () => {
  it('emits page and perPage', () => {
    expect(buildQueryString({ page: 2, perPage: 25 })).toBe('?page=2&perPage=25')
  })

  it('emits nothing for an empty query', () => {
    expect(buildQueryString({})).toBe('')
  })
})

describe('search', () => {
  it('emits the term', () => {
    expect(buildQueryString({ search: 'ada' })).toBe('?search=ada')
  })

  it('encodes characters that would break the query string', () => {
    expect(buildQueryString({ search: 'a&b=c d' })).toBe('?search=a%26b%3Dc+d')
  })

  it('omits a blank or whitespace-only term', () => {
    expect(buildQueryString({ search: '   ' })).toBe('')
  })
})

describe('sorting', () => {
  it('emits field:direction', () => {
    expect(buildQueryString({ sort: [{ field: 'email', direction: 'asc' }] })).toBe(
      '?sort=email%3Aasc',
    )
  })

  it('repeats the parameter for multiple rules, preserving order', () => {
    const result = buildQueryString({
      sort: [
        { field: 'email', direction: 'asc' },
        { field: 'createdAt', direction: 'desc' },
      ],
    })

    expect(result).toBe('?sort=email%3Aasc&sort=createdAt%3Adesc')
    // Decoded, this is the documented `?sort=email:asc&sort=createdAt:desc`.
    expect(decodeURIComponent(result)).toBe('?sort=email:asc&sort=createdAt:desc')
  })
})

describe('filtering', () => {
  it('emits field:operator:value', () => {
    const result = buildQueryString({
      filters: [{ field: 'age', operator: 'gte', value: '18' }],
    })

    expect(decodeURIComponent(result)).toBe('?filter=age:gte:18')
  })

  it('emits a comma-separated list for "in"', () => {
    const result = buildQueryString({
      filters: [{ field: 'role', operator: 'in', value: 'ADMIN,USER' }],
    })

    expect(decodeURIComponent(result)).toBe('?filter=role:in:ADMIN,USER')
  })

  it('repeats the parameter for multiple filters', () => {
    const result = buildQueryString({
      filters: [
        { field: 'age', operator: 'gte', value: '18' },
        { field: 'role', operator: 'eq', value: 'ADMIN' },
      ],
    })

    expect(decodeURIComponent(result)).toBe('?filter=age:gte:18&filter=role:eq:ADMIN')
  })

  it('drops a filter with an empty value', () => {
    // `field:op:` reads as an empty string server-side, not as "no filter".
    expect(buildQueryString({ filters: [{ field: 'name', operator: 'eq', value: '' }] })).toBe('')
  })

  it('preserves colons inside a value', () => {
    const result = buildQueryString({
      filters: [{ field: 'startedAt', operator: 'gte', value: '2024-01-01T00:00:00Z' }],
    })

    // The server splits into at most three parts, so the value survives intact.
    expect(decodeURIComponent(result)).toBe('?filter=startedAt:gte:2024-01-01T00:00:00Z')
  })
})

describe('the bracket syntax the server does not parse', () => {
  it('never appears in a generated query', () => {
    const result = buildQueryString({
      page: 2,
      perPage: 10,
      search: 'ada',
      sort: [{ field: 'email', direction: 'asc' }],
      filters: [
        { field: 'age', operator: 'gte', value: '18' },
        { field: 'role', operator: 'in', value: 'ADMIN,USER' },
      ],
    })

    const decoded = decodeURIComponent(result)
    expect(decoded).not.toContain('[')
    expect(decoded).not.toContain(']')
    expect(decoded).toContain('filter=age:gte:18')
  })
})
