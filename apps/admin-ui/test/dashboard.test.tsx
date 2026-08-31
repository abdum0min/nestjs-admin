/**
 * The dashboard, as a reader meets it.
 *
 * The landing page used to be a sentence telling people to pick something from
 * the sidebar, which is an instruction rather than an answer. What is asserted
 * here is that it now answers: numbers arrive, they link to the rows behind
 * them, and one widget that failed does not take the page with it.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { isSessionProbe, NO_LOGIN_ROUTES } from './no-login.js'

const fetchMock = vi.fn()

beforeEach(() => {
  // Pinned, because the numbers below are grouped the viewer's way and this
  // machine's own locale is nobody's business. `en-GB` matches the calendar
  // suite, which pins it for the same reason.
  Object.defineProperty(window.navigator, 'language', { value: 'en-GB', configurable: true })
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

const MODELS = [
  {
    name: 'User',
    primaryKey: ['id'],
    displayField: 'name',
    can: { list: true, read: true, create: true, update: true, delete: true },
    fields: [field('id', { isId: true }), field('name')],
  },
]

const DAY = 86_400_000

const WIDGETS = [
  {
    id: 'count-0',
    kind: 'count',
    title: 'Users',
    span: 1,
    model: 'User',
    data: { value: 1204, delta: 12, hint: '18 in the last 7 days' },
  },
  {
    id: 'count-1',
    kind: 'count',
    title: 'Suspended',
    span: 1,
    model: 'User',
    filter: 'active:eq:false',
    data: { value: 3 },
  },
  {
    id: 'stat-2',
    kind: 'stat',
    title: 'Revenue',
    description: 'Billed this month.',
    span: 1,
    data: { value: '$12,400', delta: -4, hint: 'vs last month' },
  },
  {
    id: 'list-3',
    kind: 'list',
    title: 'Newest users',
    span: 2,
    model: 'User',
    data: { records: [{ id: 'u1', label: 'Ada' }], total: 1204 },
  },
  {
    id: 'chart-4',
    kind: 'chart',
    title: 'Signups',
    span: 2,
    model: 'User',
    data: {
      total: 9,
      points: [
        { at: new Date(Date.now() - 2 * DAY).toISOString(), value: 4 },
        { at: new Date(Date.now() - DAY).toISOString(), value: 5 },
      ],
    },
  },
]

/** A server whose dashboard is whatever the test passes. */
function server(dashboard: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES

    const path = String(url)
    const body = path.includes('/dashboard')
      ? { success: true, data: dashboard }
      : path.includes('/meta')
        ? { success: true, data: { models: MODELS } }
        : // The list screen, for the one test that leaves the landing page.
          {
            success: true,
            data: [{ id: 'u1', name: 'Ada' }],
            meta: { total: 1, page: 1, perPage: 25 },
          }

    return { status: 200, ok: true, json: async () => body }
  })
}

const dashboard = (widgets: unknown = WIDGETS, generated = false) => ({ widgets, generated })

/** The card a widget's title sits in, so a number is read with its heading. */
const cardFor = (title: string): HTMLElement =>
  screen.getByText(title).closest('[data-slot="widget"]') as HTMLElement

describe('the landing page', () => {
  it('is the dashboard, not an instruction to go elsewhere', async () => {
    server(dashboard())
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    expect(screen.queryByText('Select a resource to begin.')).toBeNull()
  })

  it('shows a count, its change and its context', async () => {
    server(dashboard())
    render(<App />)
    await screen.findByText('Users')

    const users = within(cardFor('Users'))
    expect(users.getByText('1,204')).toBeTruthy()
    expect(users.getByText('+12%')).toBeTruthy()
    expect(users.getByText('18 in the last 7 days')).toBeTruthy()
  })

  it('links a count to the rows behind it, carrying its filter', async () => {
    server(dashboard())
    render(<App />)
    await screen.findByText('Suspended')

    // The number itself is the link: that is what someone reaches for.
    const link = within(cardFor('Suspended')).getByRole('link', { name: '3' })
    expect(link.getAttribute('href')).toBe('#/User?filter=active%3Aeq%3Afalse')
  })

  it('passes a stat value through without formatting it', async () => {
    server(dashboard())
    render(<App />)

    // A string carries its own currency; turning it into a number would lose it.
    expect(await screen.findByText('$12,400')).toBeTruthy()
    expect(screen.getByText('Billed this month.')).toBeTruthy()
  })

  it('does not link a stat, which names no model', async () => {
    server(dashboard())
    render(<App />)
    await screen.findByText('Revenue')

    expect(within(cardFor('Revenue')).queryByRole('link')).toBeNull()
  })

  it('links each row of a list to its record, and offers the rest', async () => {
    server(dashboard())
    render(<App />)

    const row = await screen.findByRole('link', { name: 'Ada' })
    expect(row.getAttribute('href')).toBe('#/User/u1')
    expect(screen.getByRole('link', { name: /View all 1,204/ }).getAttribute('href')).toBe('#/User')
  })

  it('draws a chart as one bar per point, each labelled with its own value', async () => {
    server(dashboard())
    render(<App />)

    const chart = await screen.findByRole('img', { name: /2 points, peak 5/ })
    expect(chart.querySelectorAll('rect')).toHaveLength(2)
    // The tooltip is a `<title>`, so the numbers are readable without a pointer.
    expect(within(chart).getByText(/: 5$/)).toBeTruthy()
  })
})

describe('a widget that failed', () => {
  it('says so in its own card and leaves the others alone', async () => {
    server(
      dashboard([
        { id: 'stat-0', kind: 'stat', title: 'Revenue', span: 1, failed: true },
        {
          id: 'count-1',
          kind: 'count',
          title: 'Users',
          span: 1,
          model: 'User',
          data: { value: 7 },
        },
      ]),
    )
    render(<App />)

    expect(await screen.findByText('Could not be loaded.')).toBeTruthy()
    // The point of a per-widget failure: the rest of the page still answers.
    expect(screen.getByText('7')).toBeTruthy()
    expect(within(cardFor('Revenue')).queryByText('7')).toBeNull()
  })
})

describe('a dashboard nobody configured', () => {
  it('says where it came from and how to replace it', async () => {
    server(dashboard(WIDGETS.slice(0, 1), true))
    render(<App />)

    expect(await screen.findByText(/Built from your schema/)).toBeTruthy()
    expect(screen.getByText('AdminModule.forRoot')).toBeTruthy()
  })

  it('stays quiet once a dashboard is declared', async () => {
    server(dashboard(WIDGETS.slice(0, 1), false))
    render(<App />)

    await screen.findByText('Users')
    expect(screen.queryByText(/Built from your schema/)).toBeNull()
  })
})

describe('navigation', () => {
  it('offers a way back to the dashboard from a resource', async () => {
    server(dashboard())
    render(<App />)

    const link = await screen.findByRole('link', { name: 'Dashboard' })
    expect(link.getAttribute('href')).toBe('#/')
    // Marked as the current page while it is, so the sidebar says where you are.
    expect(link.getAttribute('aria-current')).toBe('page')
  })

  it('drops the current marker once a resource is open', async () => {
    server(dashboard())
    window.location.hash = '#/User'
    render(<App />)

    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current'),
      ).toBeNull(),
    )
  })
})
