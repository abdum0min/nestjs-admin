/**
 * The header's shortcuts.
 *
 * ## Why the theme is set in `vi.hoisted`
 *
 * The injected theme is read once, at module load, because it is written into
 * the shell before the bundle runs and cannot change while the page is open.
 * So a test has to set the global *before* the module graph is imported, and
 * `vi.hoisted` is the only hook that runs that early - ESM hoists every import
 * above ordinary statements.
 *
 * `vi.resetModules()` and a dynamic import looks like the alternative and is a
 * trap: it gives the freshly imported shell its own copy of React while
 * Testing Library still holds the first, and nothing renders at all. The whole
 * file therefore shares one theme, and the case with no links lives in
 * `sidebar-filter.test.tsx`, which sets none.
 */
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { isSessionProbe, NO_LOGIN_ROUTES } from './no-login.js'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.__NEST_ADMIN_THEME__ = {
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'Site', href: 'https://acme.example' },
    ],
  }
})

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

const MODEL = {
  name: 'Post',
  primaryKey: ['id'],
  displayField: 'title',
  can: { list: true, read: true, create: true, update: true, delete: true },
  actions: [],
  fields: [field('id', { isId: true, isGenerated: true, readOnly: true }), field('title')],
}

beforeEach(() => {
  window.location.hash = '#/Post'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)

  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')

    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [MODEL], capabilities: {} } }
      : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } }

    return { status: 200, ok: true, json: async () => body } as unknown as Response
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('header shortcuts', () => {
  it('draws the links the application declared', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /New Post/ })

    const nav = within(screen.getByRole('navigation', { name: 'Shortcuts' }))
    expect(nav.getByRole('link', { name: 'Docs' })).toBeTruthy()
    expect(nav.getByRole('link', { name: 'Site' })).toBeTruthy()
  })

  /*
   * A link leaving this application opens away from it; one that does not
   * stays put. Nobody writes `external` for either case, so the default has to
   * be the one that is right almost always.
   */
  it('opens an absolute URL away, and a local path in place', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /New Post/ })

    const nav = within(screen.getByRole('navigation', { name: 'Shortcuts' }))
    expect(nav.getByRole('link', { name: 'Docs' }).getAttribute('target')).toBeNull()

    const away = nav.getByRole('link', { name: 'Site' })
    expect(away.getAttribute('target')).toBe('_blank')
    // `window.opener` on the far side is a handle on a page holding a session
    // that can write to every table.
    expect(away.getAttribute('rel')).toContain('noreferrer')
  })
})
