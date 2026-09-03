/**
 * Inventing a record from metadata.
 *
 * The parts worth testing by calling a function rather than over HTTP: what a
 * column's name implies, what the schema's own rules force, and the order
 * models have to be filled in so a child always has a parent.
 *
 * Nothing here asserts a *specific* generated value. The point is not that
 * `email` produces `ada.lovelace@example.com` - it is that it produces
 * something with an `@` in it, exactly once per row, and something different
 * next time unless the seed says otherwise.
 */
import type { FieldMetadata, ModelMetadata } from '@nest-admin/core'
import { describe, expect, it } from 'vitest'

import {
  draft,
  exclusiveLimit,
  fillOrder,
  foreignKeys,
  missingParents,
  writableFields,
} from '../src/dev-tools/generate.js'
import { randomFrom } from '../src/dev-tools/random.js'
import { valueFor } from '../src/dev-tools/values.js'

const field = (name: string, over: Partial<FieldMetadata> = {}): FieldMetadata => ({
  name,
  kind: 'string',
  isId: false,
  isRequired: false,
  isUnique: false,
  isList: false,
  isGenerated: false,
  ...over,
})

const random = () => randomFrom('test')

const value = (name: string, over: Partial<FieldMetadata> = {}, record = {}): unknown =>
  valueFor({ field: field(name, over), index: 0, random: random(), record })

describe('what a column name implies', () => {
  it('makes an address for an email column', () => {
    expect(String(value('email'))).toMatch(/^[^@\s]+@[^@\s]+$/)
    expect(String(value('contactEmail'))).toContain('@')
  })

  it('makes a slug from the title already on the record', () => {
    // So the two fields read as one record rather than as two unrelated ones.
    const slug = value('slug', {}, { title: 'The Quiet Harbour' })
    expect(slug).toBe('the-quiet-harbour')
  })

  it('makes money with two decimals', () => {
    const price = value('price', { kind: 'number' }) as number
    expect(Number.isFinite(price)).toBe(true)
    expect(price).toBe(Math.round(price * 100) / 100)
  })

  it('keeps a name-based guess from overriding the type', () => {
    // A column called `count` that holds a string wants the string branch.
    // Returning a number here would be a write the database rejects.
    expect(typeof value('count', { kind: 'string' })).toBe('string')
    expect(typeof value('email', { kind: 'number' })).toBe('number')
  })

  it('does not read a model name, because there is none to read', () => {
    // The whole premise: this admin renders schemas it has never seen. A
    // generator that knew about `User` would work on one application.
    const person = value('name', {}, { email: 'a@b.c' })
    const thing = value('name', {}, { sku: 'X' })
    expect(String(person).split(' ')).toHaveLength(2)
    expect(String(thing)).not.toBe(person)
  })
})

describe('what the schema forces', () => {
  it('picks from the enum and nowhere else', () => {
    const values = new Set(
      Array.from({ length: 20 }, (_, index) =>
        valueFor({
          field: field('status', { kind: 'enum', enumValues: ['DRAFT', 'LIVE'] }),
          index,
          random: random(),
          record: {},
        }),
      ),
    )
    expect([...values].every((entry) => entry === 'DRAFT' || entry === 'LIVE')).toBe(true)
  })

  it('keeps a unique column unique across a run', () => {
    // One generator for the whole run, as a real run has: a fresh one per row
    // would replay the same sequence and prove nothing.
    const shared = randomFrom('one-seed')
    const emails = Array.from({ length: 60 }, (_, index) =>
      valueFor({ field: field('email', { isUnique: true }), index, random: shared, record: {} }),
    )
    expect(new Set(emails).size).toBe(emails.length)
  })

  it('puts the discriminator before the @, so the address stays an address', () => {
    const email = String(
      valueFor({
        field: field('email', { isUnique: true }),
        index: 3,
        random: random(),
        record: {},
      }),
    )
    expect(email).toMatch(/^[^@]+@[^@]+$/)
  })

  it('leaves a kind it cannot write alone', () => {
    // Decimal, BigInt, Bytes: an adapter maps these to `unknown`, and guessing
    // produces a value the database refuses.
    expect(value('mystery', { kind: 'unknown' })).toBeUndefined()
  })

  it('spreads dates backwards rather than clustering them at now', () => {
    const shared = randomFrom('spread')
    const dates = Array.from({ length: 40 }, (_, index) =>
      valueFor({
        field: field('createdAt', { kind: 'datetime' }),
        index,
        random: shared,
        record: {},
      }),
    ) as Date[]

    // A dashboard chart over one timestamp is a single bar, which reads as a
    // broken feature on the first screen anybody sees.
    const days = new Set(dates.map((date) => date.toISOString().slice(0, 10)))
    expect(days.size).toBeGreaterThan(5)
    expect(Math.max(...dates.map((date) => date.getTime()))).toBeLessThanOrEqual(Date.now())
  })
})

describe('the same seed gives the same data', () => {
  it('repeats exactly', () => {
    const once = valueFor({
      field: field('name'),
      index: 0,
      random: randomFrom('demo'),
      record: {},
    })
    const twice = valueFor({
      field: field('name'),
      index: 0,
      random: randomFrom('demo'),
      record: {},
    })
    expect(once).toBe(twice)
  })

  it('and a different seed does not', () => {
    const a = valueFor({ field: field('bio'), index: 0, random: randomFrom('a'), record: {} })
    const b = valueFor({ field: field('bio'), index: 0, random: randomFrom('b'), record: {} })
    expect(a).not.toBe(b)
  })
})

const user: ModelMetadata = {
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  fields: [
    field('id', { isId: true, isRequired: true, isGenerated: true }),
    field('email', { isRequired: true, isUnique: true }),
    field('name'),
    field('createdAt', { kind: 'datetime', isRequired: true, isGenerated: true }),
    field('managerId'),
    field('manager', {
      kind: 'relation',
      relation: { targetModel: 'User', cardinality: 'one', from: 'managerId', to: 'id' },
    }),
    field('posts', {
      kind: 'relation',
      isList: true,
      relation: { targetModel: 'Post', cardinality: 'many' },
    }),
  ],
}

const post: ModelMetadata = {
  name: 'Post',
  primaryKey: ['id'],
  displayField: 'title',
  fields: [
    field('id', { isId: true, isRequired: true, isGenerated: true }),
    field('title', { isRequired: true }),
    field('authorId', { isRequired: true }),
    field('author', {
      kind: 'relation',
      isRequired: true,
      relation: { targetModel: 'User', cardinality: 'one', from: 'authorId', to: 'id' },
    }),
  ],
}

describe('which columns get written', () => {
  it('leaves out generated values, lists and relations', () => {
    const names = writableFields(user).map((entry) => entry.name)

    // `createdAt` is absent from the *guessing*; the seeder sets it through the
    // adapter, which is the only reason a chart has a shape.
    expect(names).not.toContain('id')
    expect(names).not.toContain('posts')
    expect(names).not.toContain('manager')
    // The scalar key is written; the relation beside it is not.
    expect(names).toContain('managerId')
    expect(names).toContain('email')
  })

  it('reads a relation optionality from its column, not from the relation', () => {
    // A relation marked required on a schema whose column is nullable would
    // make every row need a parent it does not need.
    expect(foreignKeys(user)).toEqual([
      { column: 'managerId', target: 'User', required: false, exclusive: false },
    ])
    expect(foreignKeys(post)).toEqual([
      { column: 'authorId', target: 'User', required: true, exclusive: false },
    ])
  })
})

describe('filling in an order the relations allow', () => {
  it('puts a parent before its child', () => {
    expect(fillOrder([post, user])).toEqual(['User', 'Post'])
  })

  it('does not treat an optional self-relation as a dependency', () => {
    // Otherwise every schema with a `managerId` is a cycle with itself.
    expect(fillOrder([user])).toEqual(['User'])
  })

  it('finishes even when two models require each other', () => {
    const a: ModelMetadata = {
      ...post,
      name: 'A',
      fields: [
        field('id', { isId: true, isGenerated: true }),
        field('bId', { isRequired: true }),
        field('b', {
          kind: 'relation',
          relation: { targetModel: 'B', cardinality: 'one', from: 'bId', to: 'id' },
        }),
      ],
    }
    const b: ModelMetadata = {
      ...a,
      name: 'B',
      fields: [
        field('id', { isId: true, isGenerated: true }),
        field('aId', { isRequired: true }),
        field('a', {
          kind: 'relation',
          relation: { targetModel: 'A', cardinality: 'one', from: 'aId', to: 'id' },
        }),
      ],
    }

    // Neither can be created, and refusing to generate anything at all because
    // one corner of a schema is circular would be wrong for the rest of it.
    expect([...fillOrder([a, b])].sort()).toEqual(['A', 'B'])
  })

  it('names the parents a model has nothing to point at', () => {
    expect(missingParents(post, new Map())).toEqual(['User'])
    expect(missingParents(post, new Map([['User', ['u1']]]))).toEqual([])
    // Its own model does not count: a self-relation is filled from the rows
    // this run has already made.
    expect(missingParents(user, new Map())).toEqual([])
  })
})

describe('drafting a record', () => {
  const drafted = (over: Partial<Parameters<typeof draft>[0]> = {}) =>
    draft({
      model: post,
      index: 0,
      random: randomFrom('draft'),
      parents: new Map([['User', ['u1', 'u2']]]),
      siblings: [],
      ...over,
    })

  it('links a required relation to a row that exists', () => {
    expect(['u1', 'u2']).toContain(drafted()['authorId'])
  })

  it('leaves a required relation empty when there is nothing to point at', () => {
    // Reported by the caller as "generate Users first" rather than sent to the
    // database as a null it will refuse.
    expect(drafted({ parents: new Map() })['authorId']).toBeUndefined()
  })

  it('points a self-relation at a row from this run', () => {
    const record = draft({
      model: user,
      index: 5,
      random: randomFrom('self'),
      parents: new Map(),
      siblings: ['u1', 'u2', 'u3'],
    })

    if (record['managerId'] !== undefined) {
      expect(['u1', 'u2', 'u3']).toContain(record['managerId'])
    }
  })

  it('takes a value from the application when it supplied one', () => {
    const record = drafted({
      generators: { 'Post.title': (index) => `Fixed ${index}` },
      index: 7,
    })
    expect(record['title']).toBe('Fixed 7')
  })

  it('never writes a generated column', () => {
    expect(drafted()).not.toHaveProperty('id')
  })
})

/**
 * A one-to-one, which is a unique foreign key and nothing else.
 *
 * Found by generating into the example application's schema: five profiles were
 * asked for and two arrived, because each row picked a user at random from the
 * same pool and three of them picked one that was taken. The schema was working
 * exactly as written; the generator was not reading it.
 */
const profile: ModelMetadata = {
  name: 'Profile',
  primaryKey: ['id'],
  displayField: 'headline',
  fields: [
    field('id', { isId: true, isRequired: true, isGenerated: true }),
    field('headline'),
    field('userId', { isRequired: true, isUnique: true }),
    field('user', {
      kind: 'relation',
      relation: { targetModel: 'User', cardinality: 'one', from: 'userId', to: 'id' },
    }),
  ],
}

describe('a one-to-one', () => {
  it('is read from the column being unique', () => {
    expect(foreignKeys(profile)).toEqual([
      { column: 'userId', target: 'User', required: true, exclusive: true },
    ])
  })

  it('hands out each parent once', () => {
    const parents = new Map([['User', ['u1', 'u2', 'u3']]])
    const claimed = new Map<string, Set<unknown>>()

    const ids = [0, 1, 2].map(
      (index) =>
        draft({
          model: profile,
          index,
          random: randomFrom('one-to-one'),
          parents,
          siblings: [],
          claimed,
        })['userId'],
    )

    expect(new Set(ids).size).toBe(3)
  })

  it('says how many rows the parents allow', () => {
    // Asking for twenty where five users exist can only produce five, and
    // reporting the other fifteen as errors would describe a schema behaving
    // correctly as a broken generator.
    expect(exclusiveLimit(profile, new Map([['User', ['u1', 'u2']]]))).toBe(2)
    expect(exclusiveLimit(profile, new Map())).toBe(0)
    // Nothing exclusive: no limit at all.
    expect(exclusiveLimit(post, new Map([['User', ['u1']]]))).toBeUndefined()
  })
})
