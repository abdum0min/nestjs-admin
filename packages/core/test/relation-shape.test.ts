/**
 * Telling a one-to-many from a many-to-many.
 *
 * From the parent both are "a list of related records", and the difference only
 * shows when something is written: attaching across a one-to-many moves the
 * child away from whoever had it, and detaching means clearing a column that
 * may be required. Getting this wrong offers a button that cannot work.
 */
import { describe, expect, it } from 'vitest'

import {
  detachBlockedReason,
  inverseRelationField,
  relationShape,
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

const relation = (
  name: string,
  targetModel: string,
  cardinality: 'one' | 'many',
  over: Partial<FieldMetadata> = {},
  relationName = `${targetModel}Relation`,
): FieldMetadata =>
  field(name, {
    kind: 'relation',
    isList: cardinality === 'many',
    relation: { targetModel, cardinality, name: relationName },
    ...over,
  })

const model = (name: string, ...fields: FieldMetadata[]): ModelMetadata => ({
  name,
  primaryKey: ['id'],
  fields: [field('id', { isId: true, isGenerated: true }), ...fields],
})

// User.posts (many) <-> Post.author (one, required key). A one-to-many.
const USER = model('User', field('name'), relation('posts', 'Post', 'many', {}, 'PostToUser'))
const POST = model(
  'Post',
  field('title'),
  field('authorId', { isRequired: true }),
  relation(
    'author',
    'User',
    'one',
    {
      isRequired: true,
      relation: {
        targetModel: 'User',
        cardinality: 'one',
        from: 'authorId',
        to: 'id',
        name: 'PostToUser',
      },
    },
    'PostToUser',
  ),
  relation('tags', 'Tag', 'many', {}, 'PostToTag'),
)

// Post.tags (many) <-> Tag.posts (many). A many-to-many.
const TAG = model('Tag', field('name'), relation('posts', 'Post', 'many', {}, 'PostToTag'))

const MODELS = [USER, POST, TAG]
const on = (model: ModelMetadata, name: string) =>
  model.fields.find((candidate) => candidate.name === name) as FieldMetadata

describe('finding the other half', () => {
  it('pairs the two sides by relation name', () => {
    expect(inverseRelationField(on(USER, 'posts'), MODELS)?.name).toBe('author')
    expect(inverseRelationField(on(POST, 'author'), MODELS)?.name).toBe('posts')
  })

  it('pairs a many-to-many', () => {
    expect(inverseRelationField(on(POST, 'tags'), MODELS)?.name).toBe('posts')
    expect(inverseRelationField(on(TAG, 'posts'), MODELS)?.name).toBe('tags')
  })

  it('gives up when the target is not in the model set', () => {
    // Excluded from the admin, or hidden from this principal.
    expect(inverseRelationField(on(USER, 'posts'), [USER])).toBeUndefined()
  })

  it('gives up when the adapter supplied no relation name', () => {
    const unnamed = field('posts', {
      kind: 'relation',
      isList: true,
      relation: { targetModel: 'Post', cardinality: 'many' },
    })

    expect(inverseRelationField(unnamed, MODELS)).toBeUndefined()
  })
})

describe('the shape of a relation', () => {
  it('recognises a to-one', () => {
    expect(relationShape(on(POST, 'author'), MODELS)).toBe('to-one')
  })

  it('recognises a one-to-many by its other half owning a column', () => {
    expect(relationShape(on(USER, 'posts'), MODELS)).toBe('one-to-many')
  })

  it('recognises a many-to-many by both sides being lists', () => {
    expect(relationShape(on(POST, 'tags'), MODELS)).toBe('many-to-many')
    expect(relationShape(on(TAG, 'posts'), MODELS)).toBe('many-to-many')
  })

  it('says nothing about a scalar', () => {
    expect(relationShape(on(POST, 'title'), MODELS)).toBeUndefined()
  })

  it('assumes one-to-many when the other half cannot be seen', () => {
    // The conservative answer: one-to-many is the shape whose writes have
    // preconditions, so a wrong guess refuses an operation rather than
    // performing a damaging one.
    expect(relationShape(on(POST, 'tags'), [POST])).toBe('one-to-many')
  })
})

describe('whether a child can be detached', () => {
  it('refuses when the child cannot exist without a parent', () => {
    // Clearing a required column is not something the database will allow.
    const reason = detachBlockedReason(on(USER, 'posts'), MODELS)

    expect(reason).toMatch(/Post\.author is required/)
    expect(reason).toMatch(/Delete the record/)
  })

  it('allows it when the child key is optional', () => {
    const optionalPost = model(
      'Post',
      field('authorId'),
      relation(
        'author',
        'User',
        'one',
        {
          relation: {
            targetModel: 'User',
            cardinality: 'one',
            from: 'authorId',
            name: 'PostToUser',
          },
        },
        'PostToUser',
      ),
    )

    expect(detachBlockedReason(on(USER, 'posts'), [USER, optionalPost])).toBeUndefined()
  })

  it('never blocks a many-to-many, which owns no column on either side', () => {
    expect(detachBlockedReason(on(POST, 'tags'), MODELS)).toBeUndefined()
    expect(detachBlockedReason(on(TAG, 'posts'), MODELS)).toBeUndefined()
  })

  it('says nothing about a to-one', () => {
    expect(detachBlockedReason(on(POST, 'author'), MODELS)).toBeUndefined()
  })
})
