/**
 * The schema map.
 *
 * Two halves worth different kinds of test. The layout is a pure function and
 * is tested by calling it - columns by dependency, every model placed once,
 * nothing thrown at a cycle. The drawing is tested through the page, and only
 * for the things somebody would notice: the boxes are there, a relation is
 * drawn once rather than once per end, and clicking one selects it.
 *
 * Nothing here asserts a coordinate. Where exactly a box sits is a layout
 * decision that should be free to improve; that every model *has* a place, and
 * that parents come before children, is the contract.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import type { ModelDescriptor } from '../src/api/types.js'
import { edgesOf, layout } from '../src/metadata/layout.js'
import { isSessionProbe, NO_LOGIN_ROUTES } from './no-login.js'

const fetchMock = vi.fn()

beforeEach(() => {
  window.location.hash = ''
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const field = (name: string, over: Record<string, unknown> = {}) =>
  ({
    name,
    kind: 'string',
    isId: false,
    isRequired: false,
    isUnique: false,
    isList: false,
    isGenerated: false,
    readOnly: false,
    ...over,
  }) as ModelDescriptor['fields'][number]

const model = (name: string, fields: ModelDescriptor['fields']): ModelDescriptor => ({
  name,
  primaryKey: ['id'],
  displayField: 'id',
  can: { list: true, read: true, create: true, update: true, delete: true },
  actions: [],
  fields: [field('id', { isId: true, isGenerated: true }), ...fields],
})

const user = model('User', [
  field('name'),
  field('managerId'),
  field('manager', {
    kind: 'relation',
    relation: { targetModel: 'User', cardinality: 'one', from: 'managerId', to: 'id' },
  }),
  field('posts', {
    kind: 'relation',
    isList: true,
    relation: {
      targetModel: 'Post',
      cardinality: 'many',
      name: 'PostToUser',
      shape: 'one-to-many',
    },
  }),
])

const post = model('Post', [
  field('title'),
  field('authorId', { isRequired: true }),
  field('author', {
    kind: 'relation',
    relation: {
      targetModel: 'User',
      cardinality: 'one',
      from: 'authorId',
      to: 'id',
      name: 'PostToUser',
    },
  }),
])

describe('where the boxes go', () => {
  it('places every model exactly once', () => {
    const diagram = layout([user, post])

    expect(diagram.boxes.map((box) => box.model).sort()).toEqual(['Post', 'User'])
  })

  it('puts what a model depends on to its left', () => {
    // The picture says something because of this: the left edge is where a
    // database starts and the right is what it accumulates.
    const diagram = layout([post, user])
    const at = (name: string) => diagram.boxes.find((box) => box.model === name)?.x ?? 0

    expect(at('User')).toBeLessThan(at('Post'))
  })

  it('does not treat an optional self-relation as a dependency', () => {
    // Otherwise every schema with a `managerId` is a cycle with itself and the
    // whole picture collapses into one column.
    const diagram = layout([user])

    expect(diagram.boxes).toHaveLength(1)
    expect(diagram.width).toBeGreaterThan(0)
  })

  it('draws a schema whose models require each other rather than giving up', () => {
    const a = model('A', [
      field('bId', { isRequired: true }),
      field('b', {
        kind: 'relation',
        relation: { targetModel: 'B', cardinality: 'one', from: 'bId', to: 'id' },
      }),
    ])
    const b = model('B', [
      field('aId', { isRequired: true }),
      field('a', {
        kind: 'relation',
        relation: { targetModel: 'A', cardinality: 'one', from: 'aId', to: 'id' },
      }),
    ])

    expect(layout([a, b]).boxes).toHaveLength(2)
  })

  it('has room for a schema with nothing in it', () => {
    const diagram = layout([])
    expect(diagram.boxes).toEqual([])
    expect(diagram.height).toBeGreaterThan(0)
  })
})

describe('where the lines go', () => {
  it('draws one line for a relation, not one per end', () => {
    // `User.posts` and `Post.author` are the same relationship read from two
    // sides. Drawing both would double every line on the map.
    expect(edgesOf([user, post])).toHaveLength(2)
  })

  it('marks a relation to the same model as a loop', () => {
    const self = edgesOf([user, post]).find((edge) => edge.self)
    expect(self?.from).toBe('User')
  })

  it('ignores a relation pointing outside the admin', () => {
    // The target is excluded, so there is nothing to draw a line to.
    expect(edgesOf([post])).toEqual([])
  })
})

function server() {
  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')

    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [user, post], capabilities: { useDevTools: true } } }
      : path === '/dev/doctor'
        ? { success: true, data: [] }
        : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } }

    return { status: 200, json: async () => body } as unknown as Response
  })
}

describe('on the page', () => {
  it('draws the schema', async () => {
    server()
    window.location.hash = '#/~schema'
    render(<App />)

    const map = await screen.findByRole('img', { name: 'Schema diagram' })
    expect(map.textContent).toContain('User')
    expect(map.textContent).toContain('Post')
  })

  it('says how much of the schema it is showing', async () => {
    server()
    window.location.hash = '#/~schema'
    render(<App />)

    expect(await screen.findByText(/2 models · 2 relations/)).toBeTruthy()
  })

  it('lets a model be picked out of the noise', async () => {
    server()
    window.location.hash = '#/~schema'
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'User' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /User, selected/ })).toBeTruthy())
    expect(screen.getByRole('button', { name: /Show everything/ })).toBeTruthy()
  })

  it('can be zoomed, for a schema that does not fit', async () => {
    server()
    window.location.hash = '#/~schema'
    render(<App />)

    const map = await screen.findByRole('img', { name: 'Schema diagram' })
    const before = map.getAttribute('width')

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    await waitFor(() => expect(map.getAttribute('width')).not.toBe(before))
  })
})
