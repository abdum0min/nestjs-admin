/**
 * The sidebar's filter, and the header with nothing in it.
 *
 * No theme is set here, which is the point: this is the admin an application
 * that configured nothing gets, and it has to be the quiet one. See
 * `header.test.tsx` for why a single file cannot test both themes.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { isSessionProbe, NO_LOGIN_ROUTES } from './no-login.js'

const fetchMock = vi.fn()

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

const model = (name: string) => ({
  name,
  primaryKey: ['id'],
  displayField: 'title',
  can: { list: true, read: true, create: true, update: true, delete: true },
  actions: [],
  fields: [field('id', { isId: true, isGenerated: true, readOnly: true }), field('title')],
})

function server(models: readonly unknown[]) {
  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')

    const body = path.startsWith('/meta')
      ? { success: true, data: { models, capabilities: {} } }
      : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } }

    return { status: 200, ok: true, json: async () => body } as unknown as Response
  })
}

const MANY = Array.from({ length: 14 }, (_, index) => model(`Model${index}`))

beforeEach(() => {
  window.location.hash = '#/Model0'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('an admin that configured nothing', () => {
  it('has no shortcuts in its header', async () => {
    server([model('Model0')])
    render(<App />)

    await screen.findByRole('button', { name: /New Model0/ })
    expect(screen.queryByRole('navigation', { name: 'Shortcuts' })).toBeNull()
  })
})

describe('the sidebar filter', () => {
  /*
   * A filter box above six entries costs a line of the sidebar and saves
   * nothing - the eye is faster. Past about a dozen that reverses, and a real
   * schema is usually well past it.
   */
  it('is not offered for a short list', async () => {
    server([model('Model0'), model('Model1')])
    render(<App />)

    await screen.findByRole('button', { name: /New Model0/ })
    expect(screen.queryByLabelText('Filter resources')).toBeNull()
  })

  it('is offered once the list is long enough to search', async () => {
    server(MANY)
    render(<App />)

    await screen.findByLabelText('Filter resources')
  })

  /*
   * Typing sets the groups aside. Somebody searching is looking for one thing,
   * and keeping the headings would mean the match they want can still be
   * hidden inside a folded group.
   */
  it('narrows to what matches, and says so when nothing does', async () => {
    server(MANY)
    render(<App />)

    const box = await screen.findByLabelText('Filter resources')
    const nav = within(screen.getByRole('navigation', { name: 'Resources' }))

    fireEvent.change(box, { target: { value: 'Model1' } })
    expect(nav.getByRole('link', { name: 'Model1' })).toBeTruthy()
    expect(nav.queryByRole('link', { name: 'Model2' })).toBeNull()

    fireEvent.change(box, { target: { value: 'zzzz' } })
    expect(screen.getByText('Nothing matches.')).toBeTruthy()

    // Emptying it puts everything back, rather than leaving a narrowed list
    // behind with no sign of why.
    fireEvent.change(box, { target: { value: '' } })
    expect(nav.getByRole('link', { name: 'Model2' })).toBeTruthy()
  })
})
