/**
 * What the interface does with a model that keeps its deleted rows.
 *
 * Almost all of this is wording and what is offered, which is exactly where a
 * soft delete goes wrong: a Delete button that says "this cannot be undone"
 * when it can teaches people to ignore the sentence, and the next dialog they
 * skip is the one that meant it.
 *
 * The server decides everything real. The interface reads `softDeleteField`
 * from the metadata and nothing else - there is no list of model names here
 * and no guess from a column called `deletedAt`.
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
  readOnly: false,
  ...over,
})

const ALL = { list: true, read: true, create: true, update: true, delete: true }

const model = (over: Record<string, unknown> = {}) => ({
  name: 'Post',
  primaryKey: ['id'],
  displayField: 'title',
  can: ALL,
  actions: [],
  fields: [
    field('id', { isId: true, isGenerated: true, readOnly: true }),
    field('title'),
    field('deletedAt', { kind: 'datetime', readOnly: true }),
  ],
  ...over,
})

/**
 * @param deletedAt what the one record carries, so a row can be live or marked
 */
function server(over: Record<string, unknown> = {}, deletedAt: string | null = null) {
  const calls: string[] = []
  const record = { id: 'p1', title: 'First', deletedAt }

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)

    return {
      status: 200,
      json: async () =>
        path.startsWith('/meta')
          ? { success: true, data: { models: [model(over)] } }
          : path.startsWith('/restore')
            ? { success: true, data: { ...record, deletedAt: null } }
            : init?.method === 'DELETE'
              ? { success: true, data: null }
              : path.startsWith('/Post/p1')
                ? { success: true, data: record }
                : {
                    success: true,
                    data: [record],
                    meta: { total: 1, page: 1, perPage: 25 },
                  },
    } as unknown as Response
  })

  return { calls }
}

const SOFT = { softDeleteField: 'deletedAt' }

async function openList(): Promise<void> {
  window.location.hash = '#/Post'
  render(<App />)
  await screen.findByRole('table')
}

describe('choosing what the list shows', () => {
  it('offers the three views', async () => {
    server(SOFT)
    await openList()

    const chooser = screen.getByRole('combobox', { name: /which Post to show/i })
    expect(chooser).toBeTruthy()
    expect(chooser.textContent).toContain('Live')
  })

  it('does not offer them on a model that has no deleted records', async () => {
    // The whole feature is invisible without the server's say-so. A model
    // without soft delete would answer the parameter with a 400.
    server()
    await openList()

    expect(screen.queryByRole('combobox', { name: /which Post to show/i })).toBeNull()
  })

  it('asks the server for the deleted ones, and only then', async () => {
    const { calls } = server(SOFT)
    await openList()

    // Nothing on the first load: `deleted=live` is the default, and an older
    // server would reject a parameter it has never heard of.
    expect(calls.some((call) => call.includes('deleted='))).toBe(false)

    fireEvent.click(screen.getByRole('combobox', { name: /which Post to show/i }))
    fireEvent.click(await screen.findByRole('option', { name: 'Deleted' }))

    await waitFor(() => expect(calls.some((call) => call.includes('deleted=deleted'))).toBe(true))
  })
})

describe('what Delete says it will do', () => {
  it('promises it can be restored', async () => {
    server(SOFT)
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Delete First' }))
    const dialog = await screen.findByRole('alertdialog')

    expect(dialog.textContent).toContain('can be restored later')
    expect(dialog.textContent).not.toContain('cannot be undone')
  })

  it('still says the truth on a model that destroys the row', async () => {
    server()
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Delete First' }))
    const dialog = await screen.findByRole('alertdialog')

    expect(dialog.textContent).toContain('cannot be undone')
  })
})

describe('a row that is already marked', () => {
  it('offers Restore, and a delete that means it', async () => {
    server(SOFT, '2026-09-01T10:00:00.000Z')
    await openList()

    expect(screen.getByRole('button', { name: 'Restore First' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete First forever' })).toBeTruthy()
  })

  it('restores through the reserved route', async () => {
    const { calls } = server(SOFT, '2026-09-01T10:00:00.000Z')
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Restore First' }))
    await waitFor(() => expect(calls).toContain('POST /restore/Post/p1'))
  })

  it('asks before removing it for good, and says so', async () => {
    const { calls } = server(SOFT, '2026-09-01T10:00:00.000Z')
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Delete First forever' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('cannot be undone')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }))
    await waitFor(() => expect(calls).toContain('DELETE /Post/p1?permanent=true'))
  })
})

describe('the record itself', () => {
  it('says it is deleted, rather than looking ordinary', async () => {
    // It is still readable at its own URL - that is how anybody restores one -
    // so without this it is a normal record that has silently left every list.
    server(SOFT, '2026-09-01T10:00:00.000Z')
    window.location.hash = '#/Post/p1'
    render(<App />)

    expect(await screen.findByText('This record is deleted')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Restore/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Delete forever/ })).toBeTruthy()
  })

  it('looks ordinary when it is', async () => {
    server(SOFT)
    window.location.hash = '#/Post/p1'
    render(<App />)

    await screen.findByRole('heading', { name: 'First' })
    expect(screen.queryByText('This record is deleted')).toBeNull()
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull()
  })
})
