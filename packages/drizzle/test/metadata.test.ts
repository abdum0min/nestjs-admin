/**
 * Reading a Drizzle schema into `ModelMetadata`.
 *
 * This is where the "is `OrmAdapter` a contract or a description of Prisma?"
 * question gets asked hardest: Prisma hands over a DMMF that already names
 * every relation and marks every generated column, and Drizzle hands over an
 * object of table definitions. If Core's vocabulary only fits the first, it
 * shows here.
 */
import type { FieldMetadata, ModelMetadata } from '@nest-admin/core'
import { afterEach, describe, expect, it } from 'vitest'

import { seeded } from './database.js'

const open: Array<() => void> = []

afterEach(() => {
  while (open.length > 0) open.pop()?.()
})

async function models(): Promise<readonly ModelMetadata[]> {
  const database = seeded()
  open.push(database.close)
  return database.adapter.getModels()
}

const model = (all: readonly ModelMetadata[], name: string): ModelMetadata => {
  const found = all.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`no model ${name}`)
  return found
}

const field = (owner: ModelMetadata, name: string): FieldMetadata => {
  const found = owner.fields.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`no field ${owner.name}.${name}`)
  return found
}

describe('models', () => {
  it('names a model by the key it is exported under', async () => {
    // Not the SQL table name. `users` is what the developer wrote, what their
    // own queries say, and what the admin's URLs and configuration will use.
    const all = await models()
    expect(all.map((entry) => entry.name).sort()).toEqual([
      'comments',
      'postTags',
      'posts',
      'tags',
      'users',
    ])
  })

  it('reads an inline primary key', async () => {
    expect(model(await models(), 'users').primaryKey).toEqual(['id'])
  })

  it('reads a composite primary key, which needs the dialect', async () => {
    // `primaryKey({ columns })` is only reachable through `getTableConfig`,
    // which is exported per dialect - so this also proves the dialect was
    // detected and its core loaded.
    expect(model(await models(), 'postTags').primaryKey).toEqual(['postId', 'tagId'])
  })
})

describe('fields', () => {
  it('names a field by its property key, not its column', async () => {
    // Rows come back keyed by property, so this is the name the data already
    // arrives under. `created_at` would describe nothing the admin ever sees.
    const users = model(await models(), 'users')
    expect(users.fields.map((entry) => entry.name)).toContain('createdAt')
    expect(users.fields.map((entry) => entry.name)).not.toContain('created_at')
  })

  it('maps each data type to a kind', async () => {
    const users = model(await models(), 'users')
    expect(field(users, 'name').kind).toBe('string')
    expect(field(users, 'age').kind).toBe('number')
    expect(field(users, 'active').kind).toBe('boolean')
    expect(field(users, 'createdAt').kind).toBe('datetime')
    expect(field(users, 'role').kind).toBe('enum')
    expect(field(users, 'role').enumValues).toEqual(['USER', 'ADMIN'])
  })

  it('separates a value the database supplies from one it merely suggests', async () => {
    const users = model(await models(), 'users')

    // `sql`(unixepoch())`` runs; the admin must not offer it in a form.
    expect(field(users, 'createdAt').isGenerated).toBe(true)
    expect(field(users, 'createdAt').defaultValue).toBeUndefined()

    // `'USER'` is a literal: a pre-fill, and the form should show it.
    expect(field(users, 'role').isGenerated).toBe(false)
    expect(field(users, 'role').defaultValue).toBe('USER')
    expect(field(users, 'active').defaultValue).toBe(true)
  })

  it('marks required, unique and identifying columns', async () => {
    const users = model(await models(), 'users')
    expect(field(users, 'email')).toMatchObject({ isRequired: true, isUnique: true, isId: false })
    expect(field(users, 'id')).toMatchObject({ isId: true, isUnique: true })
    expect(field(users, 'bio').isRequired).toBe(false)
  })
})

describe('relations', () => {
  it('finds both ends of a foreign key with nothing declared', async () => {
    // `posts.authorId` has no `relations()`. The admin still gets a `posts`
    // list on a user and an `author` on a post, because the key says so.
    const all = await models()

    const author = field(model(all, 'posts'), 'author')
    expect(author.relation).toMatchObject({
      targetModel: 'users',
      cardinality: 'one',
      from: 'authorId',
      to: 'id',
    })

    const owned = field(model(all, 'users'), 'posts')
    expect(owned.relation).toMatchObject({ targetModel: 'posts', cardinality: 'many' })
    expect(owned.isList).toBe(true)
  })

  it('gives both ends the same name, so they can be paired', async () => {
    // `inverseRelationField` matches on this and gives up without it - which
    // is how the admin knows which column a to-many list is filtered by.
    const all = await models()
    expect(field(model(all, 'posts'), 'author').relation?.name).toBe(
      field(model(all, 'users'), 'posts').relation?.name,
    )
  })

  it('prefers the names the developer declared', async () => {
    // `comments` declares `onPost`, and `posts` declares `discussion`. Neither
    // is what the fallback would have produced, and both must win.
    const all = await models()

    expect(field(model(all, 'comments'), 'onPost').relation).toMatchObject({
      targetModel: 'posts',
      cardinality: 'one',
      from: 'postId',
    })
    expect(field(model(all, 'posts'), 'discussion').relation).toMatchObject({
      targetModel: 'comments',
      cardinality: 'many',
    })

    // And not twice - a declared relation must not also appear under a derived
    // name beside it.
    const names = model(all, 'posts').fields.map((entry) => entry.name)
    expect(names).not.toContain('comments')
    expect(names.filter((name) => name === 'discussion')).toHaveLength(1)
  })

  it('pairs a declared many with its declared one', async () => {
    const all = await models()
    expect(field(model(all, 'posts'), 'discussion').relation?.name).toBe(
      field(model(all, 'comments'), 'onPost').relation?.name,
    )
  })

  it('shows a join table as a resource of its own', async () => {
    // Drizzle has no many-to-many. `post_tags` is a table with two foreign
    // keys, and pretending otherwise would invent a relation the schema does
    // not have.
    const all = await models()
    const join = model(all, 'postTags')

    expect(join.fields.filter((entry) => entry.relation?.cardinality === 'one')).toHaveLength(2)
    expect(field(model(all, 'posts'), 'postTags').relation?.cardinality).toBe('many')
  })

  it('takes a to-one required exactly when its key is', async () => {
    const all = await models()
    // `posts.authorId` is nullable; `comments.postId` is not.
    expect(field(model(all, 'posts'), 'author').isRequired).toBe(false)
    expect(field(model(all, 'comments'), 'onPost').isRequired).toBe(true)
  })
})
