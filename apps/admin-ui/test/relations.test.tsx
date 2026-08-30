/**
 * Relations in the interface.
 *
 * The server sends both halves of a to-one relation - the key and a small
 * object naming the record it points at. These tests are about using the right
 * half in the right place: the name where a person reads, the key where a form
 * submits.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import type { ModelDescriptor } from '../src/api/types.js'
import { foreignKeyNames, relationForForeignKey, relationLink } from '../src/metadata/relations.js'

const fetchMock = vi.fn()

beforeEach(() => {
  window.location.hash = ''
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const field = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  kind: 'string',
  isId: false,
  isRequired: false,
  isUnique: false,
  isList: false,
  isGenerated: false,
  ...over,
})

const USER: ModelDescriptor = {
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  fields: [field('id', { isId: true, isGenerated: true }), field('name')],
} as unknown as ModelDescriptor

const POST: ModelDescriptor = {
  name: 'Post',
  primaryKey: ['id'],
  displayField: 'title',
  fields: [
    field('id', { isId: true, isGenerated: true }),
    field('title', { isRequired: true }),
    field('authorId', { isRequired: true }),
    field('author', {
      kind: 'relation',
      relation: { targetModel: 'User', cardinality: 'one', from: 'authorId', to: 'id' },
    }),
    field('tags', {
      kind: 'relation',
      isList: true,
      relation: { targetModel: 'Tag', cardinality: 'many' },
    }),
  ],
} as unknown as ModelDescriptor

const POSTS = [
  {
    id: 'p1',
    title: 'On the Analytical Engine',
    authorId: 'u1',
    author: { id: 'u1', name: 'Ada' },
  },
]

function routeFetch(handlers: Record<string, unknown>): void {
  fetchMock.mockImplementation(async (url: string) => {
    const path = String(url).replace('/admin', '')
    const key = Object.keys(handlers)
      .sort((a, b) => b.length - a.length)
      .find((candidate) => path.startsWith(candidate))
    const body = key
      ? handlers[key]
      : { success: false, error: { code: 'MODEL_NOT_FOUND', message: 'x' } }
    return { status: 200, json: async () => body } as unknown as Response
  })
}

const metaOk = (models: unknown[]) => ({ success: true, data: { models } })
const listOk = (records: unknown[]) => ({
  success: true,
  data: records,
  meta: { total: records.length, page: 1, perPage: 25 },
})

describe('reading the metadata', () => {
  it('finds the relation a foreign key belongs to', () => {
    expect(relationForForeignKey(POST, 'authorId')?.name).toBe('author')
  })

  it('says nothing for an ordinary field', () => {
    expect(relationForForeignKey(POST, 'title')).toBeUndefined()
  })

  it('collects the foreign keys of a model', () => {
    expect([...foreignKeyNames(POST)]).toEqual(['authorId'])
  })

  it('builds a link from the related object', () => {
    const author = POST.fields.find((f) => f.name === 'author')!

    expect(relationLink(author, [USER], POSTS[0]!)).toEqual({
      label: 'Ada',
      id: 'u1',
      model: 'User',
    })
  })

  it('falls back to the id when the display value is empty', () => {
    // An optional label column can be null. The id is a poor name but a true
    // one, and it beats rendering "null".
    const author = POST.fields.find((f) => f.name === 'author')!
    const record = { author: { id: 'u1', name: null } }

    expect(relationLink(author, [USER], record)?.label).toBe('u1')
  })

  it('gives up when the target is not in the metadata', () => {
    // Excluded from the admin, or hidden from this principal.
    const author = POST.fields.find((f) => f.name === 'author')!

    expect(relationLink(author, [], POSTS[0]!)).toBeUndefined()
  })

  it('gives up when the relation is not set', () => {
    const author = POST.fields.find((f) => f.name === 'author')!

    expect(relationLink(author, [USER], { authorId: null })).toBeUndefined()
  })
})

describe('the list', () => {
  it('shows the related record by name, not by key', async () => {
    routeFetch({ '/meta': metaOk([USER, POST]), '/Post': listOk(POSTS) })
    window.location.hash = '#/Post'
    render(<App />)

    // The cell holds the author's name...
    const link = await screen.findByRole('link', { name: 'Ada' })
    // ...and goes to that record.
    expect(link.getAttribute('href')).toBe('#/User/u1')
    // The cuid is nowhere in sight.
    expect(screen.queryByText('u1')).toBeNull()
  })

  it('heads the column with the relation, not the key', async () => {
    // The values are authors, so `authorId` would label them with the name of
    // something else.
    routeFetch({ '/meta': metaOk([USER, POST]), '/Post': listOk(POSTS) })
    window.location.hash = '#/Post'
    render(<App />)

    expect(await screen.findByRole('columnheader', { name: 'author' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'authorId' })).toBeNull()
  })
})

describe('the form', () => {
  it('offers records by name and submits the key', async () => {
    const created = vi.fn()

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = String(url).replace('/admin', '')
      if (init?.method === 'POST') {
        created(JSON.parse(String(init.body)))
        return {
          status: 201,
          json: async () => ({ success: true, data: { id: 'p9' } }),
        } as unknown as Response
      }
      const body = path.startsWith('/meta')
        ? metaOk([USER, POST])
        : path.startsWith('/User')
          ? listOk([{ id: 'u1', name: 'Ada' }])
          : listOk([])
      return { status: 200, json: async () => body } as unknown as Response
    })

    window.location.hash = '#/Post/new'
    render(<App />)

    const search = await screen.findByPlaceholderText(/Search User/i)
    fireEvent.change(search, { target: { value: 'Ada' } })

    // The suggestion is the person's name, not their id.
    const option = await screen.findByRole('button', { name: 'Ada' })
    fireEvent.click(option)

    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: 'A post' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(created).toHaveBeenCalled())
    // What reaches the API is the foreign key.
    expect(created.mock.calls[0]![0]).toMatchObject({ authorId: 'u1', title: 'A post' })
  })
})
