/**
 * How many rows a page shows.
 *
 * It was a constant, which is a guess about a screen and a schema whoever
 * picked it has never seen. What matters here is not the control but the two
 * things around it: that changing the size goes back to the first page, and
 * that the choice survives a reload.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { isSessionProbe, NO_LOGIN_ROUTES } from './no-login.js'
import { chooseOption } from './radix.js'

const fetchMock = vi.fn()

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
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

const MODEL = {
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  can: { list: true, read: true, create: true, update: true, delete: true },
  fields: [field('id', { isId: true, isGenerated: true, readOnly: true }), field('name')],
}

/** A server with enough rows that the page size changes the page count. */
function server(total = 400) {
  const urls: string[] = []

  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    urls.push(String(url))

    const asked = new URL(String(url), 'http://x').searchParams
    const perPage = Number(asked.get('perPage') ?? 25)
    const page = Number(asked.get('page') ?? 1)

    return {
      status: 200,
      json: async () =>
        String(url).includes('/meta')
          ? { success: true, data: { models: [MODEL] } }
          : {
              success: true,
              data: [{ id: 'u1', name: 'Ada' }],
              meta: { total, page, perPage },
            },
    } as unknown as Response
  })

  return { urls }
}

const open = async (): Promise<void> => {
  window.location.hash = '#/User'
  render(<App />)
  await screen.findByRole('table')
}

const lastListUrl = (urls: string[]): string =>
  [...urls].reverse().find((url) => !url.includes('/meta')) ?? ''

describe('choosing a page size', () => {
  it('offers only sizes the server will honour', async () => {
    // It clamps perPage to 100 rather than refusing it, so an option above
    // that would silently do nothing - 500 would return 100 and no
    // explanation.
    const { urls } = server()
    await open()
    void urls

    const { optionsOf } = await import('./radix.js')
    expect(await optionsOf(screen.getByLabelText('Rows per page'))).toEqual([
      '10',
      '25',
      '50',
      '100',
    ])
  })

  it('asks the server for that many', async () => {
    const { urls } = server()
    await open()

    await chooseOption(screen.getByLabelText('Rows per page'), '100')
    await waitFor(() => expect(lastListUrl(urls)).toContain('perPage=100'))
  })

  it('goes back to the first page', async () => {
    /*
     * Page 7 of 40 is page 2 of 10 at a hundred rows, and neither is the page
     * the person was reading. Staying on 7 would show a different slice of the
     * data than the one they were looking at, with no way to tell.
     */
    const { urls } = server()
    await open()

    // The window on page 1 of 16 is [1, 2, …, 16], so 2 is the page to reach
    // for - "Page 3" is not drawn there, which is the pager working correctly.
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => expect(lastListUrl(urls)).toContain('page=2'))

    await chooseOption(screen.getByLabelText('Rows per page'), '100')
    await waitFor(() => expect(lastListUrl(urls)).toContain('page=1'))
  })

  it('changes how many pages there are', async () => {
    // 400 records: sixteen pages at 25, four at 100.
    const { urls } = server(400)
    await open()
    void urls

    expect(screen.getByRole('button', { name: 'Page 16' })).toBeTruthy()

    await chooseOption(screen.getByLabelText('Rows per page'), '100')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Page 4' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Page 16' })).toBeNull()
  })
})

describe('remembering it', () => {
  it('survives a reload', async () => {
    const { urls } = server()
    await open()
    await chooseOption(screen.getByLabelText('Rows per page'), '50')
    await waitFor(() => expect(window.localStorage.getItem('nest-admin.perPage')).toBe('50'))

    // A second visit, with the same storage.
    urls.length = 0
    window.location.hash = ''
    render(<App />)
    window.location.hash = '#/User'

    await waitFor(() => expect(lastListUrl(urls)).toContain('perPage=50'))
  })

  it('is one preference for the whole admin, not one per table', async () => {
    // "I like fifty rows" is a statement about how someone reads a table,
    // not about which table.
    const { urls } = server()
    await open()
    await chooseOption(screen.getByLabelText('Rows per page'), '50')

    await waitFor(() => expect(lastListUrl(urls)).toContain('perPage=50'))
    expect(window.localStorage.getItem('nest-admin.perPage')).toBe('50')
  })

  it('ignores a stored size it does not offer', async () => {
    // From an older version, or from someone editing storage. Left alone it
    // would be a page size no control can display or change.
    window.localStorage.setItem('nest-admin.perPage', '7')
    const { urls } = server()
    await open()

    expect(lastListUrl(urls)).toContain('perPage=25')
  })

  it('survives storage that refuses to be read', async () => {
    const boom = () => {
      throw new Error('denied')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom)

    const { urls } = server()
    await open()
    await chooseOption(screen.getByLabelText('Rows per page'), '50')

    await waitFor(() => expect(lastListUrl(urls)).toContain('perPage=50'))
    vi.restoreAllMocks()
  })
})
