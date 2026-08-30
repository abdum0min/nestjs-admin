/**
 * To-many relations on the detail page.
 *
 * Mostly about not offering an operation that cannot work. A one-to-many and a
 * many-to-many look identical - a list of related records - but attaching
 * across the first moves a record away from whoever had it, and detaching from
 * it is impossible when the child's key is required. The server says which is
 * which; these assert the interface believes it.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { parseHash, href } from '../src/hooks/use-route.js'

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

const USER = {
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  fields: [
    field('id', { isId: true, isGenerated: true }),
    field('name'),
    field('posts', {
      kind: 'relation',
      isList: true,
      relation: {
        targetModel: 'Post',
        cardinality: 'many',
        shape: 'one-to-many',
        targetForeignKey: 'authorId',
        detachBlocked: 'Post.author is required, so a Post record cannot exist without one.',
      },
    }),
  ],
}

const POST = {
  name: 'Post',
  primaryKey: ['id'],
  displayField: 'title',
  fields: [
    field('id', { isId: true, isGenerated: true }),
    field('title'),
    field('authorId'),
    field('tags', {
      kind: 'relation',
      isList: true,
      relation: { targetModel: 'Tag', cardinality: 'many', shape: 'many-to-many' },
    }),
  ],
}

const TAG = {
  name: 'Tag',
  primaryKey: ['id'],
  displayField: 'name',
  fields: [field('id', { isId: true, isGenerated: true }), field('name')],
}

const envelope = (data: unknown, meta?: unknown) => ({
  success: true,
  data,
  ...(meta ? { meta } : {}),
})

const page = (records: unknown[]) =>
  envelope(records, { total: records.length, page: 1, perPage: 5 })

/** Records every request, and answers from a small routing table. */
function server(handlers: Array<[RegExp, (init?: RequestInit) => unknown]>): {
  calls: string[]
} {
  const calls: string[] = []

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace('/admin', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)

    for (const [pattern, respond] of handlers) {
      if (pattern.test(path)) {
        return {
          status: 200,
          json: async () => respond(init),
        } as unknown as Response
      }
    }

    return {
      status: 404,
      json: async () => ({ success: false, error: { code: 'MODEL_NOT_FOUND', message: 'x' } }),
    } as unknown as Response
  })

  return { calls }
}

describe('a one-to-many on the parent', () => {
  const handlers: Array<[RegExp, () => unknown]> = [
    [/^\/meta/, () => envelope({ models: [USER, POST, TAG] })],
    [/^\/User\/u1\/posts/, () => page([{ id: 'p1', title: 'First', authorId: 'u1' }])],
    [/^\/User\/u1/, () => envelope({ id: 'u1', name: 'Ada' })],
  ]

  it('shows the children with a count', async () => {
    server(handlers)
    window.location.hash = '#/User/u1'
    render(<App />)

    // The section is headed by the relation and carries the total, so the
    // reader knows whether the rows below are all of them.
    const heading = await screen.findByRole('heading', { name: /posts/ })
    expect(heading.textContent).toContain('(1)')
    expect(await screen.findByText('First')).toBeTruthy()
  })

  it('does not offer detach when the child key is required', async () => {
    // The server would refuse it, so the button would only ever fail.
    server(handlers)
    window.location.hash = '#/User/u1'
    render(<App />)

    await screen.findByText('First')
    expect(screen.queryByRole('button', { name: 'Detach' })).toBeNull()
  })

  it('says why, rather than leaving the absence unexplained', async () => {
    server(handlers)
    window.location.hash = '#/User/u1'
    render(<App />)

    expect(await screen.findByText(/Post\.author is required/)).toBeTruthy()
  })

  it('warns that attaching moves a record rather than copying it', async () => {
    // It rewrites the child's foreign key, so it takes the record away from
    // whatever holds it now - a consequence on a page the reader is not on.
    server(handlers)
    window.location.hash = '#/User/u1'
    render(<App />)

    expect(await screen.findByText(/moves the Post record here/)).toBeTruthy()
  })

  it('links to the child list, filtered to this parent', async () => {
    server(handlers)
    window.location.hash = '#/User/u1'
    render(<App />)

    const link = await screen.findByRole('link', { name: /View all Post/ })

    expect(link.getAttribute('href')).toBe(
      href({ kind: 'list', model: 'Post', filter: 'authorId:eq:u1' }),
    )
  })
})

describe('a many-to-many on the parent', () => {
  const handlers: Array<[RegExp, () => unknown]> = [
    [/^\/meta/, () => envelope({ models: [USER, POST, TAG] })],
    [/^\/Post\/p1\/tags/, () => page([{ id: 't1', name: 'prisma' }])],
    [/^\/Post\/p1/, () => envelope({ id: 'p1', title: 'First' })],
  ]

  it('offers detach, because no column is required on either side', async () => {
    server(handlers)
    window.location.hash = '#/Post/p1'
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Detach' })).toBeTruthy()
  })

  it('does not warn about moving records, because nothing moves', async () => {
    server(handlers)
    window.location.hash = '#/Post/p1'
    render(<App />)

    await screen.findByText('prisma')
    expect(screen.queryByText(/moves the Tag record/)).toBeNull()
  })

  it('offers no filtered child list, because there is no column to filter on', async () => {
    server(handlers)
    window.location.hash = '#/Post/p1'
    render(<App />)

    await screen.findByText('prisma')
    expect(screen.queryByRole('link', { name: /View all/ })).toBeNull()
  })

  it('detaches through the nested route and reloads', async () => {
    const { calls } = server(handlers)
    window.location.hash = '#/Post/p1'
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Detach' }))

    await waitFor(() => expect(calls).toContain('DELETE /Post/p1/tags/t1'))
    // The list is re-read rather than patched locally: the server is the
    // authority on what is linked.
    await waitFor(() =>
      expect(calls.filter((call) => call.startsWith('GET /Post/p1/tags')).length).toBeGreaterThan(
        1,
      ),
    )
  })
})

describe('the filter a link carries', () => {
  it('survives a round trip through the hash', () => {
    const route = { kind: 'list', model: 'Post', filter: 'authorId:eq:u1' } as const

    expect(parseHash(href(route))).toEqual(route)
  })

  it('opens the list already filtered', async () => {
    const { calls } = server([
      [/^\/meta/, () => envelope({ models: [USER, POST, TAG] })],
      [/^\/Post/, () => page([{ id: 'p1', title: 'First', authorId: 'u1' }])],
    ])
    window.location.hash = '#/Post?filter=authorId:eq:u1'
    render(<App />)

    await screen.findByText('First')

    // Every list request carries it. A single unfiltered request would mean the
    // reader saw the wrong rows, however briefly.
    const lists = calls.filter((call) => call.startsWith('GET /Post?'))
    expect(lists.length).toBeGreaterThan(0)
    expect(lists.every((call) => call.includes('filter=authorId'))).toBe(true)
  })
})
