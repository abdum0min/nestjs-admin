/**
 * Relation routes against an integer primary key.
 *
 * The Prisma adapter shipped a defect here: an id from a URL is a string, and
 * two places turned one into a query argument without converting it to the
 * key's declared type. This asks the same questions of the Drizzle adapter.
 *
 * The answer is expected to be different by construction rather than by care -
 * a related list here is filtered by the *parent record's own* key value, read
 * back from the row, so the string never reaches the comparison. These tests
 * exist to keep that true, not to celebrate it: `#byId` still coerces, and if
 * either mechanism is removed one of these fails.
 */
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

describe('an integer primary key', () => {
  it('addresses a record by a string id', async () => {
    expect(await adapter.findOne('meters', '1')).toMatchObject({ label: 'visits' })
  })

  it('lists a related page from a string id', async () => {
    const page = await adapter.listRelated('meters', '1', 'samples', {})

    expect(page.total).toBe(2)
    expect(page.data.map((row) => row['value']).sort((a, b) => Number(a) - Number(b))).toEqual([
      10, 20,
    ])
  })

  it('attaches and detaches from string ids', async () => {
    const orphan = await adapter.create('samples', { value: 30 })

    await adapter.attachRelated('meters', '1', 'samples', String(orphan['id']))
    expect((await adapter.listRelated('meters', '1', 'samples', {})).total).toBe(3)

    await adapter.detachRelated('meters', '1', 'samples', String(orphan['id']))
    expect((await adapter.listRelated('meters', '1', 'samples', {})).total).toBe(2)
  })

  it('still accepts a number, for a programmatic caller', async () => {
    expect(await adapter.findOne('meters', 1)).toMatchObject({ label: 'visits' })
    expect((await adapter.listRelated('meters', 1, 'samples', {})).total).toBe(2)
  })

  it('reports a missing record rather than matching nothing', async () => {
    expect(await adapter.findOne('meters', '999')).toBeNull()
  })
})
