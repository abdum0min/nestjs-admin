/**
 * Applying per-model configuration to the metadata.
 *
 * The important property is that `hidden` **removes** rather than marks. Every
 * layer downstream reads the metadata to decide what it may do, so a removed
 * field is unreachable by construction; a flag would have needed each of them
 * to remember to check it, and one that forgot would be a leak.
 */
import { describe, expect, it } from 'vitest'

import {
  applyOverrides,
  fieldOverride,
  isReadOnly,
  unknownOverrideNames,
  unusablePlaceholders,
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

const USER: ModelMetadata = {
  name: 'User',
  primaryKey: ['id'],
  fields: [
    field('id', { isId: true, isGenerated: true }),
    field('email', { isUnique: true }),
    field('name'),
    field('passwordHash'),
  ],
}

const MODELS = [USER]
const namesOf = (models: readonly ModelMetadata[], model = 'User') =>
  models.find((candidate) => candidate.name === model)?.fields.map((f) => f.name)

describe('hidden fields', () => {
  it('are removed from the model', () => {
    const applied = applyOverrides(MODELS, { User: { fields: { passwordHash: { hidden: true } } } })

    expect(namesOf(applied)).toEqual(['id', 'email', 'name'])
  })

  it('leave the others in their original order', () => {
    const applied = applyOverrides(MODELS, { User: { fields: { email: { hidden: true } } } })

    expect(namesOf(applied)).toEqual(['id', 'name', 'passwordHash'])
  })

  it('are not removed when the flag is false or absent', () => {
    const applied = applyOverrides(MODELS, {
      User: { fields: { passwordHash: { hidden: false }, email: { label: 'Email' } } },
    })

    expect(namesOf(applied)).toEqual(['id', 'email', 'name', 'passwordHash'])
  })
})

describe('other overrides', () => {
  it('carry a declared display field on the model', () => {
    // So the adapter and the metadata document agree on it without either
    // consulting the configuration.
    const [applied] = applyOverrides(MODELS, { User: { displayField: 'email' } })

    expect(applied?.displayField).toBe('email')
  })

  it('leave a model nobody configured untouched', () => {
    const applied = applyOverrides(MODELS, { Other: { label: 'x' } })

    expect(applied[0]).toBe(USER)
  })

  it('return the models unchanged when there is no configuration', () => {
    expect(applyOverrides(MODELS, undefined)).toBe(MODELS)
  })
})

describe('read-only', () => {
  it('is true for a generated field whatever the configuration says', () => {
    // The database produces the value; it was never writable.
    const id = USER.fields[0]!

    expect(isReadOnly(undefined, 'User', id)).toBe(true)
    expect(isReadOnly({ User: { fields: { id: { readOnly: false } } } }, 'User', id)).toBe(true)
  })

  it('is true for a field the application marked', () => {
    const name = USER.fields[2]!

    expect(isReadOnly({ User: { fields: { name: { readOnly: true } } } }, 'User', name)).toBe(true)
  })

  it('is false otherwise', () => {
    expect(isReadOnly(undefined, 'User', USER.fields[2]!)).toBe(false)
  })
})

describe('looking up one field override', () => {
  const overrides = { User: { fields: { name: { label: 'Full name' } } } }

  it('finds it', () => {
    expect(fieldOverride(overrides, 'User', 'name')?.label).toBe('Full name')
  })

  it('says nothing for a field, model or configuration that has none', () => {
    expect(fieldOverride(overrides, 'User', 'email')).toBeUndefined()
    expect(fieldOverride(overrides, 'Other', 'name')).toBeUndefined()
    expect(fieldOverride(undefined, 'User', 'name')).toBeUndefined()
  })
})

describe('names that match nothing', () => {
  it('reports an unknown model', () => {
    expect(unknownOverrideNames(MODELS, { Nope: {} })).toEqual(['Nope'])
  })

  it('reports an unknown field, qualified by its model', () => {
    expect(unknownOverrideNames(MODELS, { User: { fields: { nope: {} } } })).toEqual(['User.nope'])
  })

  it('reports an unknown display field', () => {
    expect(unknownOverrideNames(MODELS, { User: { displayField: 'nope' } })).toEqual(['User.nope'])
  })

  it('reports several at once, so one run fixes them all', () => {
    const unknown = unknownOverrideNames(MODELS, {
      Nope: {},
      User: { fields: { a: {}, b: {} } },
    })

    expect(unknown).toEqual(['Nope', 'User.a', 'User.b'])
  })

  it('says nothing when everything matches, or when there is no configuration', () => {
    expect(unknownOverrideNames(MODELS, { User: { fields: { email: { hidden: true } } } })).toEqual(
      [],
    )
    expect(unknownOverrideNames(MODELS, undefined)).toEqual([])
  })
})

describe('unusablePlaceholders', () => {
  it('accepts the three forms that mean the same thing from every route', () => {
    const fine = (placeholder: string) =>
      unusablePlaceholders({ User: { fields: { avatarUrl: { placeholder } } } })

    expect(fine('https://cdn.example.com/a.png')).toEqual([])
    expect(fine('http://localhost:3000/a.png')).toEqual([])
    expect(fine('//cdn.example.com/a.png')).toEqual([])
    expect(fine('/img/avatar.png')).toEqual([])
    expect(fine('data:image/svg+xml,%3Csvg%3E%3C/svg%3E')).toEqual([])
  })

  it('names a relative path, which resolves differently on every screen', () => {
    expect(
      unusablePlaceholders({ User: { fields: { avatarUrl: { placeholder: 'img/a.png' } } } }),
    ).toEqual(['User.avatarUrl'])

    expect(
      unusablePlaceholders({ User: { fields: { avatarUrl: { placeholder: './a.png' } } } }),
    ).toEqual(['User.avatarUrl'])
  })

  it('names a data URI that is not an image', () => {
    // It cannot execute from an `img` src, so this is not a hole - it is a
    // value that would draw nothing, which is worth saying out loud rather
    // than rendering as a blank square.
    expect(
      unusablePlaceholders({
        User: { fields: { avatarUrl: { placeholder: 'data:text/html,<b>x</b>' } } },
      }),
    ).toEqual(['User.avatarUrl'])
  })

  it('says nothing about fields that declared none', () => {
    expect(unusablePlaceholders(undefined)).toEqual([])
    expect(unusablePlaceholders({ User: { fields: { avatarUrl: { widget: 'image' } } } })).toEqual(
      [],
    )
  })
})
