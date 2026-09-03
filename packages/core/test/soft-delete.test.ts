/**
 * Which columns can carry a soft delete, and which cannot.
 *
 * Every case here is a configuration that would fail silently in the worst
 * direction. A column the admin cannot clear leaves records marked forever; a
 * column it cannot write a date into falls through to destroying the row -
 * which is precisely the behaviour somebody turned this option on to prevent.
 */
import { describe, expect, it } from 'vitest'

import {
  isReadOnly,
  isSoftDeleteField,
  softDeleteFieldOf,
  unusableSoftDeleteFields,
  type FieldMetadata,
  type ModelMetadata,
} from '../src/index.js'

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

const MODELS: readonly ModelMetadata[] = [
  {
    name: 'Post',
    primaryKey: ['id'],
    displayField: 'title',
    fields: [
      field('id', { isId: true, isRequired: true, isGenerated: true }),
      field('title', { isRequired: true }),
      field('deletedAt', { kind: 'datetime' }),
      field('createdAt', { kind: 'datetime', isRequired: true, isGenerated: true }),
      field('publishedAt', { kind: 'datetime', isRequired: true }),
      // Optional, so it gets past the check above and reaches the one it is
      // here for.
      field('syncedAt', { kind: 'datetime', isGenerated: true }),
      field('archived', { kind: 'boolean' }),
    ],
  },
]

describe('reading the configuration', () => {
  it('finds the column a model declared', () => {
    expect(softDeleteFieldOf({ Post: { softDelete: 'deletedAt' } }, 'Post')).toBe('deletedAt')
    expect(isSoftDeleteField({ Post: { softDelete: 'deletedAt' } }, 'Post', 'deletedAt')).toBe(true)
  })

  it('says nothing about a model that declared none', () => {
    expect(softDeleteFieldOf({ Post: {} }, 'Post')).toBeUndefined()
    expect(softDeleteFieldOf(undefined, 'Post')).toBeUndefined()
    expect(isSoftDeleteField({ Post: { softDelete: 'deletedAt' } }, 'Post', 'title')).toBe(false)
  })
})

describe('the column is not writable through a form', () => {
  it('is read-only, like a generated value', () => {
    // Editable, it would be a date picker that deletes the record when it is
    // filled in and restores it when it is cleared - the two operations the
    // buttons perform, reachable by accident and with no confirmation.
    const overrides = { Post: { softDelete: 'deletedAt' } }
    const deletedAt = MODELS[0]!.fields.find((f) => f.name === 'deletedAt')!

    expect(isReadOnly(overrides, 'Post', deletedAt)).toBe(true)
    expect(isReadOnly({ Post: {} }, 'Post', deletedAt)).toBe(false)
  })
})

describe('columns that cannot carry it', () => {
  const problems = (column: string) =>
    unusableSoftDeleteFields(MODELS, { Post: { softDelete: column } })

  it('accepts an optional date the database does not generate', () => {
    expect(problems('deletedAt')).toEqual([])
  })

  it('refuses a column the model does not have', () => {
    expect(problems('deleted_at')[0]).toMatch(/not a column on Post/)
  })

  it('refuses a boolean, and says why a date is wanted', () => {
    // Supportable later without changing anything here. Refused now rather
    // than half-supported, because a boolean has two ways of saying "not
    // deleted" - `false` and `null` - and no reader keeps them straight.
    expect(problems('archived')[0]).toMatch(/records when, which a flag cannot/)
  })

  it('refuses a required column, which has nowhere to put "not deleted"', () => {
    expect(problems('publishedAt')[0]).toMatch(/required/)
  })

  it('refuses a generated column, which the admin cannot clear', () => {
    expect(problems('syncedAt')[0]).toMatch(/produced by the database/)
  })

  it('says nothing about models that did not ask for it', () => {
    expect(unusableSoftDeleteFields(MODELS, undefined)).toEqual([])
    expect(unusableSoftDeleteFields(MODELS, { Post: {} })).toEqual([])
    // A model the admin does not have is reported by name elsewhere; saying it
    // twice in different words helps nobody.
    expect(unusableSoftDeleteFields(MODELS, { Nope: { softDelete: 'deletedAt' } })).toEqual([])
  })
})
