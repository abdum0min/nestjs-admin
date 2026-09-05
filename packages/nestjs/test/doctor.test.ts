/**
 * What the admin had to guess, reported.
 *
 * Every finding here corresponds to something that currently happens
 * **silently**: a relation picker full of cuids, a related list missing its
 * buttons, a model whose row actions all fail. The tests are written as the
 * symptom rather than as the rule, because the rule is the easy half - the
 * value is in the finding firing for the schema that actually has the problem
 * and staying quiet for the one that does not.
 */
import type { FieldMetadata, ModelMetadata } from '@nest-admin/core'
import { describe, expect, it } from 'vitest'

import { diagnose, type DiagnosisInput } from '../src/dev-tools/doctor.js'

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

const model = (name: string, fields: readonly FieldMetadata[]): ModelMetadata => ({
  name,
  primaryKey: ['id'],
  displayField: undefined as unknown as string,
  fields: [field('id', { isId: true, isRequired: true, isGenerated: true }), ...fields],
})

const report = (models: readonly ModelMetadata[], over: Partial<DiagnosisInput> = {}) =>
  diagnose({
    models,
    overrides: undefined,
    concurrency: 'last-write-wins',
    storage: true,
    ...over,
  })

const codes = (models: readonly ModelMetadata[], over: Partial<DiagnosisInput> = {}) =>
  report(models, over).map((finding) => finding.code)

/** A model with nothing to complain about. */
const healthy = model('Post', [
  field('title'),
  field('createdAt', { kind: 'datetime', isRequired: true, isGenerated: true }),
])

describe('a schema with nothing wrong', () => {
  it('reports nothing', () => {
    expect(report([healthy])).toEqual([])
  })
})

describe('a model whose id is all it can show', () => {
  it('is reported, because every reference to it shows a cuid', () => {
    // The most visible symptom in the product, and the one most often mistaken
    // for the admin being broken.
    const events = model('Event', [
      field('at', { kind: 'datetime', isRequired: true }),
      field('count', { kind: 'number' }),
    ])

    const [finding] = report([events])
    expect(finding?.code).toBe('display-field-fell-back')
    expect(finding?.severity).toBe('guessed')
    expect(finding?.detail).toContain('relation picker')
  })

  it('suggests a column the rule itself would not have picked', () => {
    // The rule only considers strings; a number or an enum is still better
    // than a cuid, and the person can point at one.
    const events = model('Event', [field('code', { kind: 'number' })])

    expect(report([events])[0]?.fix).toBe("models: { Event: { displayField: 'code' } }")
  })

  it('offers no fix when the model has nothing readable at all', () => {
    // Pretending an option exists would be worse than saying nothing.
    const link = model('Link', [field('other', { isGenerated: true })])

    expect(report([link])[0]?.fix).toBeUndefined()
  })

  it('says nothing when the application already declared one', () => {
    const events = model('Event', [field('at', { kind: 'datetime' })])

    expect(codes([events], { overrides: { Event: { displayField: 'at' } } })).not.toContain(
      'display-field-fell-back',
    )
  })
})

describe('a key the admin cannot address a row by', () => {
  it('reports a composite primary key as broken', () => {
    const review: ModelMetadata = {
      ...model('Review', [field('body')]),
      primaryKey: ['userId', 'productId'],
    }

    const finding = report([review]).find((entry) => entry.code === 'composite-primary-key')
    expect(finding?.severity).toBe('broken')
    // The distinction that matters: the list works, everything below it does not.
    expect(finding?.detail).toContain('The list itself works')
  })

  it('reports a model with no key at all', () => {
    const view: ModelMetadata = { ...model('Snapshot', [field('body')]), primaryKey: [] }
    expect(codes([view])).toContain('no-primary-key')
  })
})

describe('a relation whose other half could not be found', () => {
  const orphan = model('Author', [
    field('name'),
    field('books', {
      kind: 'relation',
      isList: true,
      relation: { targetModel: 'Book', cardinality: 'many', name: 'AuthorToBook' },
    }),
  ])

  it('is reported, because the buttons quietly disappear', () => {
    const finding = report([orphan]).find((entry) => entry.code === 'unpaired-relation')

    expect(finding?.field).toBe('books')
    expect(finding?.detail).toContain('Attach or Detach')
  })

  it('says nothing when both halves are there', () => {
    const book = model('Book', [
      field('title'),
      field('author', {
        kind: 'relation',
        relation: {
          targetModel: 'Author',
          cardinality: 'one',
          from: 'authorId',
          to: 'id',
          name: 'AuthorToBook',
        },
      }),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
    ])

    expect(codes([orphan, book])).not.toContain('unpaired-relation')
  })
})

describe('dates the admin looks for', () => {
  it('says which models the dashboard cannot chart', () => {
    const tag = model('Tag', [field('name')])

    const finding = report([tag]).find((entry) => entry.code === 'no-created-at')
    expect(finding?.severity).toBe('guessed')
    expect(finding?.detail).toContain('chart')
  })

  it('says where the concurrency guard is not running', () => {
    // Turned on everywhere and silently absent here, which is the failure mode
    // of every safety check nobody can see.
    const tag = model('Tag', [
      field('name'),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
    ])

    const finding = report([tag], { concurrency: 'optimistic' }).find(
      (entry) => entry.code === 'no-version-column',
    )
    expect(finding?.severity).toBe('broken')
    expect(finding?.detail).toContain('overwrite each other silently')
  })

  it('says nothing about versions when the guard is off', () => {
    const tag = model('Tag', [
      field('name'),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
    ])

    expect(codes([tag])).not.toContain('no-version-column')
  })
})

describe('a column the admin cannot edit safely', () => {
  it('is broken when a record cannot be created without it', () => {
    // Decimal, BigInt and Bytes arrive as `unknown`. Required and with no
    // default, there is no value the form can produce that the database takes.
    const invoice = model('Invoice', [
      field('total', { kind: 'unknown', isRequired: true }),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
      field('reference'),
    ])

    const finding = report([invoice]).find((entry) => entry.code === 'unsupported-column')
    expect(finding?.severity).toBe('broken')
    expect(finding?.fix).toContain('readOnly: true')
  })

  it('is only a guess when the column is optional', () => {
    const invoice = model('Invoice', [
      field('weight', { kind: 'unknown' }),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
      field('reference'),
    ])

    expect(report([invoice])[0]?.severity).toBe('guessed')
  })

  it('says nothing about one the database fills in', () => {
    const invoice = model('Invoice', [
      field('total', { kind: 'unknown', isRequired: true, isGenerated: true }),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
      field('reference'),
    ])

    expect(codes([invoice])).not.toContain('unsupported-column')
  })
})

describe('a file field with nowhere to put a file', () => {
  const withUpload = model('User', [
    field('name'),
    field('avatarUrl'),
    field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
  ])
  const overrides = { User: { fields: { avatarUrl: { widget: 'image' as const } } } }

  it('is reported when files are turned off', () => {
    const finding = report([withUpload], { overrides, storage: false }).find(
      (entry) => entry.code === 'file-field-without-storage',
    )

    expect(finding?.severity).toBe('broken')
    // The one finding whose answer can differ between a laptop and a
    // deployment, which is worth saying out loud on a screen that only runs
    // on the laptop.
    expect(finding?.detail).toContain('deployment')
  })

  it('says nothing when there is storage', () => {
    expect(codes([withUpload], { overrides, storage: true })).not.toContain(
      'file-field-without-storage',
    )
  })
})

describe('the order findings arrive in', () => {
  it('puts what is broken first', () => {
    // Somebody scanning this list is looking for what is actually failing.
    const broken: ModelMetadata = { ...model('Review', [field('body')]), primaryKey: ['a', 'b'] }
    const guessed = model('Tag', [field('name')])

    const severities = report([guessed, broken]).map((finding) => finding.severity)
    expect(severities[0]).toBe('broken')
    expect(severities.at(-1)).toBe('guessed')
  })
})
