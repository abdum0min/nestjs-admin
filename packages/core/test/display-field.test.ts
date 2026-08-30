/**
 * Picking the field that names a record.
 *
 * The rule decides what a person sees wherever a relation is rendered, so the
 * cases below are mostly about *not* picking something unreadable: an id, a
 * cuid, a boolean, a relation.
 */
import { displayFieldFor, type FieldMetadata, type ModelMetadata } from '../src/index.js'
import { describe, expect, it } from 'vitest'

const field = (name: string, overrides: Partial<FieldMetadata> = {}): FieldMetadata => ({
  name,
  kind: 'string',
  isId: false,
  isRequired: true,
  isUnique: false,
  isList: false,
  isGenerated: false,
  ...overrides,
})

const id = field('id', { isId: true, isGenerated: true })

const model = (...fields: FieldMetadata[]): ModelMetadata => ({
  name: 'Thing',
  primaryKey: ['id'],
  fields,
})

describe('conventional names', () => {
  it('prefers name', () => {
    expect(displayFieldFor(model(id, field('slug'), field('name')))).toBe('name')
  })

  it('accepts the usual alternatives', () => {
    for (const candidate of ['title', 'label', 'displayName', 'username', 'email', 'slug']) {
      expect(displayFieldFor(model(id, field(candidate)))).toBe(candidate)
    }
  })

  it('follows the order, not the schema', () => {
    // A model with both is common - `title` is the label, `slug` is the URL.
    expect(displayFieldFor(model(id, field('slug'), field('title')))).toBe('title')
    expect(displayFieldFor(model(id, field('email'), field('name')))).toBe('name')
  })
})

describe('without a conventional name', () => {
  it('prefers a unique string, which usually identifies the record', () => {
    const chosen = displayFieldFor(model(id, field('note'), field('reference', { isUnique: true })))

    expect(chosen).toBe('reference')
  })

  it('otherwise takes the first plain string', () => {
    expect(displayFieldFor(model(id, field('note'), field('other')))).toBe('note')
  })
})

describe('what it refuses to pick', () => {
  it('skips non-strings', () => {
    const chosen = displayFieldFor(
      model(id, field('age', { kind: 'number' }), field('active', { kind: 'boolean' })),
    )

    // Nothing readable, so the primary key - see below.
    expect(chosen).toBe('id')
  })

  it('skips generated strings, which are cuids rather than words', () => {
    const chosen = displayFieldFor(model(id, field('token', { isGenerated: true })))

    expect(chosen).toBe('id')
  })

  it('skips relations and lists', () => {
    const chosen = displayFieldFor(
      model(
        id,
        field('tags', { isList: true }),
        field('author', {
          kind: 'relation',
          relation: { targetModel: 'User', cardinality: 'one' },
        }),
      ),
    )

    expect(chosen).toBe('id')
  })

  it('does not pick the id when something readable exists', () => {
    expect(displayFieldFor(model(id, field('note')))).toBe('note')
  })
})

describe('the fallback', () => {
  it('is the primary key when no field is readable', () => {
    // Honest rather than good: an id is not a label, but it beats blank.
    expect(displayFieldFor(model(id, field('createdAt', { kind: 'datetime' })))).toBe('id')
  })

  it('uses the first primary-key field of a composite key', () => {
    const composite: ModelMetadata = {
      name: 'Membership',
      primaryKey: ['userId', 'groupId'],
      fields: [
        field('userId', { isId: true, isGenerated: true }),
        field('groupId', { isId: true, isGenerated: true }),
      ],
    }

    expect(displayFieldFor(composite)).toBe('userId')
  })

  it('survives a model with no fields at all', () => {
    const empty: ModelMetadata = { name: 'Empty', primaryKey: [], fields: [] }

    expect(displayFieldFor(empty)).toBe('id')
  })
})
