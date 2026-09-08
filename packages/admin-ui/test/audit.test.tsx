/**
 * The history screen.
 *
 * What is worth asserting is not the table. It is that the screen offers undo
 * only where the server said it was possible, says why where it is not, and
 * shows the refusal when one comes back - because an Undo button that looks
 * available and quietly does nothing is worse than no button.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { isSessionProbe, NO_LOGIN_ROUTES } from './no-login.js'

const fetchMock = vi.fn()

beforeEach(() => {
  window.location.hash = ''
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

const field = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  kind: 'string',
  isId: false,
  isRequired: false,
  isUnique: false,
  isList: false,
  isGenerated: false,
  readOnly: false,
  ...over,
})

const MODEL = {
  name: 'Post',
  primaryKey: ['id'],
  displayField: 'title',
  can: { list: true, read: true, create: true, update: true, delete: true },
  actions: [],
  fields: [field('id', { isId: true, isGenerated: true, readOnly: true }), field('title')],
}

const CHANGED = {
  id: 'e1',
  at: '2026-09-08T09:00:00.000Z',
  actor: 'Ada',
  actorEmail: 'ada@example.com',
  action: 'update',
  model: 'Post',
  recordId: 'p1',
  recordLabel: 'The quiet harbour',
  outcome: 'ok',
  changes: [{ field: 'title', from: 'Old', to: 'The quiet harbour' }],
  summary: 'Changed title on The quiet harbour',
  undoable: true,
}

const RAN = {
  id: 'e2',
  at: '2026-09-08T08:00:00.000Z',
  actor: 'Ada',
  action: 'action',
  model: 'Post',
  recordId: 'p1',
  outcome: 'ok',
  summary: 'Ran Post — publish',
  undoable: false,
  undoableReason: 'An application action ran code this admin did not write.',
}

function server({
  capabilities = { viewAuditLog: true },
  entries = [CHANGED, RAN],
  onUndo,
}: {
  capabilities?: Record<string, unknown>
  entries?: readonly unknown[]
  onUndo?: () => { status: number; body: unknown }
} = {}) {
  const calls: string[] = []

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)

    if (path.includes('/undo')) {
      const answer = onUndo?.() ?? { status: 200, body: { success: true, data: null } }
      return {
        status: answer.status,
        ok: answer.status < 400,
        json: async () => answer.body,
      } as never
    }

    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [MODEL], capabilities } }
      : path.startsWith('/audit/activity')
        ? { success: true, data: { count: 2, days: 7, recent: [] } }
        : path.startsWith('/audit')
          ? {
              success: true,
              data: entries,
              meta: { total: entries.length, page: 1, perPage: 25 },
            }
          : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } }

    return { status: 200, ok: true, json: async () => body } as unknown as Response
  })

  return calls
}

describe('the history screen', () => {
  it('is offered in the sidebar only where there is a history to read', async () => {
    server({ capabilities: {} })
    window.location.hash = '#/Post'
    render(<App />)

    await screen.findByRole('button', { name: /New Post/ })
    const nav = within(screen.getByRole('navigation', { name: 'Resources' }))
    expect(nav.queryByRole('link', { name: 'History' })).toBeNull()
  })

  it('is offered where the server says there is', async () => {
    server()
    window.location.hash = '#/Post'
    render(<App />)

    await screen.findByRole('button', { name: /New Post/ })
    const nav = within(screen.getByRole('navigation', { name: 'Resources' }))
    expect(nav.getByRole('link', { name: 'History' })).toBeTruthy()
  })

  it('shows who did what, and expands to the fields', async () => {
    server()
    window.location.hash = '#/~audit'
    render(<App />)

    await screen.findByText('Changed title on The quiet harbour')

    fireEvent.click(screen.getByRole('button', { name: /Changed title/ }))

    await screen.findByText('Was')
    expect(screen.getByText('Old')).toBeTruthy()
  })

  /*
   * The server says whether an entry is structurally reversible. It cannot say
   * whether this person may or whether the record has moved, so the screen
   * offers the button and shows the refusal when it comes.
   */
  it('offers undo only where the entry could be put back', async () => {
    server()
    window.location.hash = '#/~audit'
    render(<App />)

    await screen.findByText('Changed title on The quiet harbour')
    expect(screen.getAllByRole('button', { name: /Undo/ })).toHaveLength(1)
  })

  it('says why an entry cannot be put back', async () => {
    server()
    window.location.hash = '#/~audit'
    render(<App />)

    await screen.findByText('Ran Post — publish')
    fireEvent.click(screen.getByRole('button', { name: /Ran Post/ }))

    await screen.findByText(/ran code this admin did not write/)
  })

  it('shows the refusal when the record has moved since', async () => {
    server({
      onUndo: () => ({
        status: 400,
        body: {
          success: false,
          error: {
            code: 'INVALID_QUERY',
            message:
              'This record has changed since: title is no longer what this entry left behind.',
          },
        },
      }),
    })

    window.location.hash = '#/~audit'
    render(<App />)

    await screen.findByText('Changed title on The quiet harbour')
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))

    // The confirmation first: an undo is a new change, not a rewind. Its
    // button shares a label with the one in the row, so it is found inside
    // the dialog rather than by name alone.
    const dialog = within(await screen.findByRole('alertdialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(screen.getByText(/has changed since/)).toBeTruthy())
  })

  it('narrows to one record, which is what the History button links to', async () => {
    const calls = server()
    window.location.hash = '#/~audit?model=Post&record=p1'
    render(<App />)

    await screen.findByText(/History of/)
    await waitFor(() => expect(calls.some((call) => call.includes('record=p1'))).toBe(true))
  })
})

describe('the record screen', () => {
  it('links to the history of that record', async () => {
    server()
    window.location.hash = '#/Post/p1'
    render(<App />)

    const rail = within(await screen.findByRole('complementary'))
    const link = rail.getByRole('link', { name: /History/ })

    expect(link.getAttribute('href')).toContain('record=p1')
    expect(link.getAttribute('target')).toBeNull()
  })
})
