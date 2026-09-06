/**
 * The schema report, on screen.
 *
 * What this asserts is whether anybody reads it: one entry per **problem**
 * rather than per model, the models listed once inside it, a way out beside
 * each entry, a fold when nothing is failing, and a count in the navigation
 * only for what actually fails.
 *
 * The first version failed every one of those and still passed its tests,
 * because the tests asked whether a finding rendered rather than whether the
 * page could be read.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const model = {
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  can: { list: true, read: true, create: true, update: true, delete: true },
  actions: [],
  fields: [
    {
      name: 'id',
      kind: 'string',
      isId: true,
      isRequired: true,
      isUnique: false,
      isList: false,
      isGenerated: true,
      readOnly: true,
    },
  ],
}

const FAILING = {
  code: 'unaddressable-key',
  severity: 'broken',
  subjects: ['Review'],
  title: 'A model has no single-column primary key',
  detail: 'Opening, editing and deleting fail. The list itself works.',
  remedies: [],
}

/** The one that used to be printed eight times. */
const UNVERSIONED = {
  code: 'no-version-column',
  severity: 'warning',
  subjects: ['Profile', 'Category', 'Product', 'Tag', 'Order', 'OrderItem', 'Comment', 'Review'],
  title: 'Optimistic concurrency is not running on 8 models',
  detail: 'The guard compares a column recording when the row last changed.',
  remedies: [
    { kind: 'schema', label: 'Add the column', code: 'updatedAt DateTime @updatedAt' },
    { kind: 'option', label: 'Or turn it off', code: "concurrency: 'last-write-wins'" },
  ],
}

function server(findings: readonly unknown[] = []) {
  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')

    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [model], capabilities: { useDevTools: true } } }
      : path === '/dev/doctor'
        ? { success: true, data: findings }
        : path.startsWith('/dashboard')
          ? { success: true, data: { widgets: [] } }
          : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } }

    return { status: 200, json: async () => body } as unknown as Response
  })
}

async function openSchema(): Promise<void> {
  window.location.hash = '#/~schema'
  render(<App />)
  await screen.findByRole('heading', { name: 'Schema' })
}

describe('when there is nothing to report', () => {
  it('says so in one line rather than taking a quarter of the screen', async () => {
    // A panel that spends that much space saying "everything is fine" trains
    // people to skip the place where the problems appear.
    server()
    await openSchema()

    expect(await screen.findByText('Nothing to report')).toBeTruthy()
  })

  it('leaves the navigation alone', async () => {
    server()
    window.location.hash = '#/'
    render(<App />)

    const link = await screen.findByRole('link', { name: /Schema/ })
    expect(link.textContent).not.toMatch(/\d/)
  })
})

describe('one entry is one problem', () => {
  it('lists eight models inside a single finding', async () => {
    // The first version printed this paragraph eight times, once per model.
    server([UNVERSIONED])
    await openSchema()

    fireEvent.click(await screen.findByRole('button', { name: /Schema report/ }))

    expect(await screen.findByText(UNVERSIONED.title)).toBeTruthy()
    expect(screen.getAllByText(UNVERSIONED.detail)).toHaveLength(1)
    expect(screen.getByText('Profile')).toBeTruthy()
    expect(screen.getByText('Comment')).toBeTruthy()
  })

  it('offers every way out, not just a configuration option', async () => {
    // The most repeated sentence in the first version was an apology; a
    // `@updatedAt` column was the answer all along.
    server([UNVERSIONED])
    await openSchema()

    fireEvent.click(await screen.findByRole('button', { name: /Schema report/ }))

    expect(await screen.findByText('updatedAt DateTime @updatedAt')).toBeTruthy()
    expect(screen.getByText("concurrency: 'last-write-wins'")).toBeTruthy()
  })
})

describe('severity is about requests failing', () => {
  it('says nothing is failing when nothing is', async () => {
    server([UNVERSIONED])
    await openSchema()

    expect(await screen.findByText(/nothing is failing/)).toBeTruthy()
  })

  it('opens itself, and counts, only for what fails', async () => {
    server([FAILING, UNVERSIONED])
    await openSchema()

    // Open without being asked: the reader has not come looking for this one.
    expect(await screen.findByText(FAILING.title)).toBeTruthy()
    expect(screen.getByText('1 failing')).toBeTruthy()
  })

  it('admits when there is nothing to change', async () => {
    server([FAILING])
    await openSchema()

    expect(await screen.findByText(/the schema being what it is/)).toBeTruthy()
  })

  it('can be folded away', async () => {
    server([FAILING])
    await openSchema()

    const header = await screen.findByRole('button', { name: /Schema report/ })
    expect(header.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(header)
    await waitFor(() => expect(screen.queryByText(FAILING.title)).toBeNull())
  })
})

describe('the count in the navigation', () => {
  it('appears for what is failing', async () => {
    server([FAILING])
    window.location.hash = '#/'
    render(<App />)

    const link = await screen.findByRole('link', { name: /Schema/ })
    await waitFor(() => expect(link.textContent).toContain('1'))
  })

  it('ignores everything else', async () => {
    // Most schemas leave the admin guessing something. A badge that never goes
    // out is a warning people stop seeing.
    server([UNVERSIONED])
    window.location.hash = '#/'
    render(<App />)

    const link = await screen.findByRole('link', { name: /Schema/ })
    await waitFor(() => expect(link.textContent).toContain('Schema'))
    expect(link.textContent).not.toContain('8')
  })
})
