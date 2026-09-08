/**
 * Custom pages, in the interface.
 *
 * The assertions that matter are about containment rather than about drawing.
 * A page is the one place code this package did not write runs inside its
 * shell, so what has to be proven is that the shell survives it: a module that
 * throws takes its own area of the screen and nothing else, and the reserved
 * routes keep working however an application names its pages.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { parseHash } from '../src/hooks/use-route.js'
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

const WIDGET_PAGE = { path: 'health', title: 'Shop health', kind: 'widgets' }

function server({
  pages = [WIDGET_PAGE],
  widgets = [{ id: 'w1', kind: 'count', title: 'People', span: 1, data: { value: 12 } }],
}: {
  pages?: readonly unknown[]
  widgets?: readonly unknown[]
} = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')

    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [MODEL], capabilities: {}, pages } }
      : path.startsWith('/pages/')
        ? { success: true, data: { widgets, generated: false } }
        : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } }

    return { status: 200, ok: true, json: async () => body } as unknown as Response
  })
}

describe('the route space', () => {
  /*
   * The four reserved names are matched before the page rule. Without that
   * ordering, an application that called a page `audit` would silently take
   * the history screen's route - and the symptom would be the history screen
   * quietly becoming somebody else's page.
   */
  it('keeps the reserved screens ahead of any page', () => {
    expect(parseHash('#/~audit')).toEqual({ kind: 'audit' })
    expect(parseHash('#/~team')).toEqual({ kind: 'team' })
    expect(parseHash('#/~dev')).toEqual({ kind: 'dev' })
    expect(parseHash('#/~schema')).toEqual({ kind: 'schema' })
  })

  it('reads any other tilde route as a page', () => {
    expect(parseHash('#/~health')).toEqual({ kind: 'page', path: 'health' })
  })

  /*
   * A page cannot shadow a model, whatever either is called. This is the whole
   * reason the tilde is there.
   */
  it('leaves model routes alone', () => {
    expect(parseHash('#/Post')).toMatchObject({ kind: 'list', model: 'Post' })
    expect(parseHash('#/Post/p1')).toMatchObject({ kind: 'detail', model: 'Post', id: 'p1' })
  })
})

describe('the sidebar', () => {
  it('offers a page, going to its own route', async () => {
    server()
    window.location.hash = '#/Post'
    render(<App />)

    await screen.findByRole('button', { name: /New Post/ })
    const nav = within(screen.getByRole('navigation', { name: 'Resources' }))
    const link = nav.getByRole('link', { name: 'Shop health' })

    expect(link.getAttribute('href')).toBe('#/~health')
    // Same as every other in-admin link: no new tab.
    expect(link.getAttribute('target')).toBeNull()
  })

  it('offers nothing when the server sent no pages', async () => {
    server({ pages: [] })
    window.location.hash = '#/Post'
    render(<App />)

    await screen.findByRole('button', { name: /New Post/ })
    const nav = within(screen.getByRole('navigation', { name: 'Resources' }))
    expect(nav.queryByRole('link', { name: 'Shop health' })).toBeNull()
  })
})

describe('a widget page', () => {
  it('draws the widgets the server resolved', async () => {
    server()
    window.location.hash = '#/~health'
    render(<App />)

    await screen.findByRole('heading', { name: 'Shop health' })
    expect(await screen.findByText('People')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
  })

  /*
   * Same wording as an unavailable resource, and for the same reason: the page
   * may not exist or may be closed to this principal, and the interface cannot
   * tell those apart. Guessing would leak which it is.
   */
  it('says a page is unavailable rather than guessing why', async () => {
    server({ pages: [] })
    window.location.hash = '#/~health'
    render(<App />)

    expect(await screen.findByText('Page not available')).toBeTruthy()
  })
})

describe('an embedded page', () => {
  it('sandboxes it, and withholds same-origin access from another host', async () => {
    server({
      pages: [
        { path: 'internal', title: 'Internal', kind: 'embed', url: '/notes.html' },
        { path: 'external', title: 'External', kind: 'embed', url: 'https://example.com/board' },
      ],
    })

    window.location.hash = '#/~internal'
    const view = render(<App />)
    await screen.findByRole('heading', { name: 'Internal' })

    const ours = document.querySelector('iframe')
    expect(ours?.getAttribute('sandbox')).toContain('allow-same-origin')

    view.unmount()
    window.location.hash = '#/~external'
    render(<App />)
    await screen.findByRole('heading', { name: 'External' })

    // An external document given `allow-same-origin` could reach this page,
    // and this page is holding a session that can write to every table.
    const theirs = document.querySelector('iframe')
    expect(theirs?.getAttribute('sandbox')).not.toContain('allow-same-origin')
  })
})

describe('a module page that fails', () => {
  /*
   * The load is a dynamic import of a URL the application controls, which jsdom
   * cannot resolve - so this exercises the real failure path rather than a
   * simulated one. What matters is which part of the screen is lost.
   */
  it('is contained: the shell and the navigation survive it', async () => {
    server({ pages: [{ path: 'own', title: 'Own page', kind: 'module', module: '/nope.js' }] })

    window.location.hash = '#/~own'
    render(<App />)

    await screen.findByRole('heading', { name: 'Own page' })

    // The sidebar is still there, and still lists the resources.
    const nav = within(screen.getByRole('navigation', { name: 'Resources' }))
    expect(nav.getByRole('link', { name: 'Dashboard' })).toBeTruthy()

    // And the failure is reported where the page would have been.
    await waitFor(() => expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy())
  })
})
