/**
 * What the admin had to guess, reported.
 *
 * Every finding corresponds to something that happens **silently** today: a
 * relation picker full of cuids, a related list missing its buttons, a model
 * whose row actions all fail. The tests are written as the symptom rather than
 * as the rule, because the rule is the easy half - the value is in a finding
 * firing for the schema that has the problem and staying quiet for the one that
 * does not.
 *
 * Two properties get their own section at the bottom, because the first version
 * of this file passed while the report was unreadable: **one finding is one
 * problem**, not one model, and **severity is about requests failing**, not
 * about disappointment.
 */
import type { FieldMetadata, ModelMetadata } from '@nest-admin/core'
import { describe, expect, it } from 'vitest'

import { diagnose, type DiagnosisInput, type Finding } from '../src/dev-tools/doctor.js'

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

const find = (
  models: readonly ModelMetadata[],
  code: string,
  over: Partial<DiagnosisInput> = {},
): Finding | undefined => report(models, over).find((finding) => finding.code === code)

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

describe('a request that fails today', () => {
  it('reports a key the admin cannot address a row by', () => {
    const review: ModelMetadata = {
      ...model('Review', [field('body')]),
      primaryKey: ['userId', 'productId'],
    }

    const finding = find([review], 'unaddressable-key')
    expect(finding?.severity).toBe('broken')
    // The distinction that matters: the list works, everything below it does not.
    expect(finding?.detail).toContain('The list itself works')
  })

  it('reports a required column it cannot produce a value for', () => {
    const invoice = model('Invoice', [
      field('total', { kind: 'unknown', isRequired: true }),
      field('reference'),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
    ])

    const finding = find([invoice], 'unwritable-required-column')
    expect(finding?.severity).toBe('broken')
    expect(finding?.subjects).toEqual(['Invoice.total'])
  })

  it('says nothing about one the database fills in', () => {
    const invoice = model('Invoice', [
      field('total', { kind: 'unknown', isRequired: true, isGenerated: true }),
      field('reference'),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
    ])

    expect(codes([invoice])).not.toContain('unwritable-required-column')
  })

  it('reports a relation pointing at a model this admin excludes', () => {
    // The field is dropped from the metadata before any screen sees it, which
    // is right for a hidden model and a surprise if the exclusion was a typo.
    const post = model('Post', [
      field('title'),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
      field('author', {
        kind: 'relation',
        relation: { targetModel: 'User', cardinality: 'one', from: 'authorId', to: 'id' },
      }),
    ])

    const finding = find([post], 'relation-to-excluded-model')
    expect(finding?.severity).toBe('broken')
    expect(finding?.subjects[0]).toContain('User')
  })
})

describe('something asked for that is not happening', () => {
  it('says where the concurrency guard is not running, once', () => {
    const models = ['A', 'B', 'C'].map((name) =>
      model(name, [
        field('title'),
        field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
      ]),
    )

    const finding = find(models, 'no-version-column', { concurrency: 'optimistic' })
    expect(finding?.severity).toBe('warning')
    expect(finding?.subjects).toEqual(['A', 'B', 'C'])
    // Both ways out, because either is a real answer.
    expect(finding?.remedies.map((remedy) => remedy.kind)).toEqual(['schema', 'option'])
  })

  it('says nothing about versions when the guard is off', () => {
    const tag = model('Tag', [
      field('name'),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
    ])
    expect(codes([tag])).not.toContain('no-version-column')
  })

  it('reports a model that can only show its id, and names a column to use', () => {
    const events = model('Event', [
      field('at', { kind: 'datetime', isRequired: true }),
      field('count', { kind: 'number' }),
    ])

    const finding = find([events], 'display-field-fell-back')
    expect(finding?.severity).toBe('warning')
    expect(finding?.remedies[0]?.code).toBe("models: { Event: { displayField: 'at' } }")
  })

  it('says nothing when the application already nominated one', () => {
    const events = model('Event', [field('at', { kind: 'datetime' })])
    expect(codes([events], { overrides: { Event: { displayField: 'at' } } })).not.toContain(
      'display-field-fell-back',
    )
  })

  it('reports a relation whose other half is missing', () => {
    const orphan = model('Author', [
      field('name'),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
      field('books', {
        kind: 'relation',
        isList: true,
        relation: { targetModel: 'Author', cardinality: 'many', name: 'AuthorToBook' },
      }),
    ])

    const finding = find([orphan], 'unpaired-relation')
    expect(finding?.subjects).toEqual(['Author.books'])
    expect(finding?.detail).toContain('Attach or Detach')
  })

  it('reports a model whose Edit button opens an empty form', () => {
    // Usually a join table, and worth hiding rather than showing as a dead end.
    const join = model('PostToTag', [
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
      field('post', {
        kind: 'relation',
        relation: { targetModel: 'PostToTag', cardinality: 'one', from: 'postId', to: 'id' },
      }),
    ])

    expect(find([join], 'nothing-to-edit')?.severity).toBe('warning')
  })
})

describe('configuration that was written and never applied', () => {
  const user = model('User', [
    field('age', { kind: 'number' }),
    field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
  ])

  it('reports upload options on a field with no upload', () => {
    const finding = find([user], 'inert-file-options', {
      overrides: { User: { fields: { age: { maxSize: '2mb' } } } },
    })

    expect(finding?.severity).toBe('note')
    expect(finding?.subjects).toEqual(['User.age'])
  })

  it('says nothing when the widget those options are for is there', () => {
    const withFile = model('User', [
      field('avatarUrl'),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
    ])

    expect(
      codes([withFile], {
        overrides: { User: { fields: { avatarUrl: { widget: 'image', maxSize: '2mb' } } } },
      }),
    ).not.toContain('inert-file-options')
  })

  it('reports a widget the column cannot carry', () => {
    // A colour picker on a number: the interface falls back and says nothing,
    // so the option reads as applied when it is not.
    const finding = find([user], 'widget-kind-mismatch', {
      overrides: { User: { fields: { age: { widget: 'color' } } } },
    })

    expect(finding?.subjects).toEqual(['User.age'])
  })

  it('reports a display field that is never returned', () => {
    const person = model('Person', [
      field('secret'),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
    ])

    const finding = find([person], 'write-only-display-field', {
      overrides: { Person: { displayField: 'secret', fields: { secret: { writeOnly: true } } } },
    })

    expect(finding?.detail).toContain('blank')
  })
})

describe('what the admin can only do so much about', () => {
  it('says which models the dashboard cannot chart', () => {
    const tag = model('Tag', [field('name')])

    const finding = find([tag], 'no-created-at')
    expect(finding?.severity).toBe('note')
    expect(finding?.remedies[0]?.kind).toBe('schema')
  })

  it('says where the search box can never match anything', () => {
    const reading = model('Reading', [
      field('value', { kind: 'number' }),
      field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
    ])

    expect(find([reading], 'nothing-to-search')?.severity).toBe('note')
  })
})

describe('one finding is one problem', () => {
  it('does not repeat the same paragraph once per model', () => {
    // The first version printed this eight times against the example schema,
    // which is how a report becomes a wall nobody reads.
    const models = ['A', 'B', 'C', 'D', 'E'].map((name) =>
      model(name, [
        field('title'),
        field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
      ]),
    )

    const findings = report(models, { concurrency: 'optimistic' })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.subjects).toHaveLength(5)
    expect(findings[0]?.title).toContain('5 models')
  })

  it('reads correctly for one of them', () => {
    const one = [
      model('A', [
        field('title'),
        field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
      ]),
    ]

    expect(find(one, 'no-version-column', { concurrency: 'optimistic' })?.title).toContain(
      'one model',
    )
  })
})

describe('severity is about requests failing', () => {
  it('does not call a missing version column broken', () => {
    // The first version did, and lit the navigation up with an eight while
    // nothing was failing.
    const models = ['A', 'B'].map((name) =>
      model(name, [
        field('title'),
        field('createdAt', { kind: 'datetime', isGenerated: true, isRequired: true }),
      ]),
    )

    const findings = report(models, { concurrency: 'optimistic' })
    expect(findings.every((finding) => finding.severity !== 'broken')).toBe(true)
  })

  it('puts what fails first', () => {
    const broken: ModelMetadata = { ...model('Review', [field('body')]), primaryKey: ['a', 'b'] }
    const note = model('Tag', [field('name')])

    expect(report([note, broken])[0]?.severity).toBe('broken')
  })
})
