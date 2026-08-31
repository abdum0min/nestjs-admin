/**
 * Relation routes against a numeric primary key.
 *
 * A regression suite for the first defect a consumer found in a published
 * release. Ids arrive from a URL as strings; a Prisma `Int @id` must be queried
 * with a number. The adapter knew that and coerced in `#whereById` - but two
 * other places turn an id into a Prisma argument and neither of them did:
 *
 *   toRelatedWhere()  the parent id inside `{ post: { is: { id } } }`
 *   #link()           the target id inside `{ connect: { id } }`
 *
 * So every relation route worked on a string-keyed model and failed on an
 * integer-keyed one with `Expected IntFilter or Int, provided String`.
 *
 * It went unnoticed because the fixture's only integer-keyed model had no
 * relations. That is the actual lesson, and it is why `Counter` now has three:
 * a to-one inverse, a many-to-many, and a self-relation - the same three shapes
 * the reporting consumer's schema had.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { PrismaAdapter } from '../src/adapter.js'
import { createTestClient, FIXTURE_SCHEMA_PATH, resetDatabase } from './client.js'

const client = createTestClient()
const adapter = new PrismaAdapter({ client, schemaPath: FIXTURE_SCHEMA_PATH })

/** Captured as created, then passed back as strings - as a URL would carry them. */
let counterId: number
let markerId: number
let readingId: number

beforeEach(async () => {
  await resetDatabase(client)

  const marker = await client.marker.create({ data: { name: 'weekly' } })
  markerId = marker.id

  const counter = await client.counter.create({
    data: { label: 'visits', markers: { connect: { id: marker.id } } },
  })
  counterId = counter.id

  const root = await client.reading.create({ data: { value: 1, counterId: counter.id } })
  readingId = root.id

  await client.reading.create({ data: { value: 2, counterId: counter.id, parentId: root.id } })
})

afterAll(async () => {
  await client.$disconnect()
})

describe('listing across a relation', () => {
  it('accepts a string id for a to-one inverse', async () => {
    // `{ counter: { is: { id: 1 } } }` - the shape that failed.
    const page = await adapter.listRelated('Counter', String(counterId), 'readings', {})

    expect(page.total).toBe(2)
    expect(page.data.map((row) => row['value']).sort()).toEqual([1, 2])
  })

  it('accepts a string id across a many-to-many', async () => {
    // `{ counters: { some: { id: 1 } } }` - the other branch of the same code.
    const page = await adapter.listRelated('Counter', String(counterId), 'markers', {})

    expect(page.total).toBe(1)
    expect(page.data[0]?.['id']).toBe(markerId)
  })

  it('accepts a string id across a self-relation', async () => {
    const page = await adapter.listRelated('Reading', String(readingId), 'children', {})

    expect(page.total).toBe(1)
    expect(page.data[0]?.['value']).toBe(2)
  })

  it('still applies filters and pagination on top', async () => {
    const page = await adapter.listRelated('Counter', String(counterId), 'readings', {
      filters: [{ field: 'value', operator: 'gt', value: 1 }],
    })

    expect(page.data.map((row) => row['value'])).toEqual([2])
  })

  it('reports a missing parent as not found rather than as an empty page', async () => {
    // The id coerces fine; the record is simply absent.
    await expect(adapter.listRelated('Counter', '99999', 'readings', {})).rejects.toMatchObject({
      kind: 'record-not-found',
    })
  })

  it('refuses an id that is not a number for a numeric key', async () => {
    await expect(adapter.listRelated('Counter', 'abc', 'readings', {})).rejects.toMatchObject({
      kind: 'invalid-query',
    })
  })
})

describe('attaching and detaching across a relation', () => {
  it('accepts string ids on both sides', async () => {
    const second = await client.marker.create({ data: { name: `m2-${Date.now()}` } })

    // Both the parent id and the target id go through a different code path
    // than `listRelated`, and the target one was the second missed coercion.
    await adapter.attachRelated('Counter', String(counterId), 'markers', String(second.id))

    const after = await adapter.listRelated('Counter', String(counterId), 'markers', {})
    expect(after.total).toBe(2)

    await adapter.detachRelated('Counter', String(counterId), 'markers', String(second.id))
    expect((await adapter.listRelated('Counter', String(counterId), 'markers', {})).total).toBe(1)
  })

  it('re-parents across a self-relation', async () => {
    const orphan = await client.reading.create({ data: { value: 9, counterId } })

    await adapter.attachRelated('Reading', String(readingId), 'children', String(orphan.id))

    const children = await adapter.listRelated('Reading', String(readingId), 'children', {})
    expect(children.total).toBe(2)
  })

  it('refuses a target id that is not a number for a numeric key', async () => {
    await expect(
      adapter.attachRelated('Counter', String(counterId), 'markers', 'abc'),
    ).rejects.toMatchObject({ kind: 'invalid-query' })
  })
})

describe('a numeric id is still accepted as a number', () => {
  it('coerces nothing when the caller already passed one', async () => {
    // The HTTP layer sends strings, but the adapter is public API and a
    // programmatic caller has the real value.
    const page = await adapter.listRelated('Counter', counterId, 'readings', {})
    expect(page.total).toBe(2)
  })
})
