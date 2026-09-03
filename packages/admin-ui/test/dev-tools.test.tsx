/**
 * The developer tools screen.
 *
 * The interface owns almost nothing here - the server decides what may be
 * generated and what may be emptied. What this file asserts is the part that is
 * the interface's alone: the screen is unreachable unless the server says the
 * tools exist, the preview writes nothing, and the button that empties a table
 * asks first.
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

function server(capabilities: Record<string, unknown> = { useDevTools: true }) {
  const calls: string[] = []

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)

    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [model], capabilities } }
      : path === '/dev'
        ? {
            success: true,
            data: { models: ['User', 'Post'], faker: false, images: true, lastRun: undefined },
          }
        : path === '/dev/preview'
          ? {
              success: true,
              data: { model: 'User', records: [{ email: 'ada@example.com', name: 'Ada' }] },
            }
          : path === '/dev/generate' || path === '/dev/fill'
            ? {
                success: true,
                data:
                  path === '/dev/fill'
                    ? [{ model: 'User', created: 12, ids: [], failed: [] }]
                    : { model: 'User', created: 20, ids: [], failed: [] },
              }
            : path === '/dev/truncate'
              ? { success: true, data: { deleted: 12, remaining: 0 } }
              : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } }

    return { status: 200, json: async () => body } as unknown as Response
  })

  return { calls }
}

async function openTools(): Promise<void> {
  window.location.hash = '#/~dev'
  render(<App />)
  await screen.findByRole('heading', { name: 'Developer tools' })
}

describe('whether the screen exists at all', () => {
  it('is in the navigation when the server says so', async () => {
    server()
    window.location.hash = '#/'
    render(<App />)

    const link = await screen.findByRole('link', { name: /Developer tools/ })
    expect(link.getAttribute('href')).toBe('#/~dev')
  })

  it('is absent when it does not', async () => {
    // A build without the tools and a role without the capability look
    // identical from here, which is right: neither is part of this admin.
    server({ useDevTools: false })
    window.location.hash = '#/'
    render(<App />)

    await screen.findByRole('link', { name: 'Dashboard' })
    expect(screen.queryByRole('link', { name: /Developer tools/ })).toBeNull()
  })

  it('is absent against a server that has never heard of it', async () => {
    server({})
    window.location.hash = '#/'
    render(<App />)

    await screen.findByRole('link', { name: 'Dashboard' })
    expect(screen.queryByRole('link', { name: /Developer tools/ })).toBeNull()
  })

  it('is marked as not being one of the resources', async () => {
    server()
    window.location.hash = '#/'
    render(<App />)

    const link = await screen.findByRole('link', { name: /Developer tools/ })
    // A tool that can empty a table must not look like a table.
    expect(link.textContent).toContain('Dev')
  })
})

describe('generating', () => {
  it('offers the models the server said it may write', async () => {
    server()
    await openTools()

    const chooser = screen.getByRole('combobox', { name: /model to generate/i })
    expect(chooser.textContent).toContain('User')
  })

  it('previews without writing anything', async () => {
    const { calls } = server()
    await openTools()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByText('ada@example.com')).toBeTruthy()
    expect(calls).toContain('POST /dev/preview')
    expect(calls).not.toContain('POST /dev/generate')
  })

  it('fills every model from one button', async () => {
    const { calls } = server()
    await openTools()

    fireEvent.click(screen.getByRole('button', { name: /Fill every model/ }))

    await waitFor(() => expect(calls).toContain('POST /dev/fill'))
    expect(await screen.findByText(/12 records/)).toBeTruthy()
  })

  it('reports what a run created', async () => {
    server()
    await openTools()

    fireEvent.click(screen.getByRole('button', { name: /^Generate$/ }))
    expect(await screen.findByText(/20 records/)).toBeTruthy()
  })
})

describe('emptying a model', () => {
  it('asks before it does it', async () => {
    const { calls } = server()
    await openTools()

    fireEvent.click(screen.getByRole('button', { name: /Empty User/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('cannot be undone')
    expect(calls).not.toContain('POST /dev/truncate')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete everything' }))
    await waitFor(() => expect(calls).toContain('POST /dev/truncate'))
  })
})

describe('what it says about faker', () => {
  it('says it is optional rather than missing', async () => {
    // "Install ten megabytes before you can see any data" is the sort of first
    // step that ends an evaluation, so the absence is stated as a fact about
    // the words rather than as something wrong.
    server()
    await openTools()

    expect(screen.getByText('built-in words')).toBeTruthy()
  })
})
