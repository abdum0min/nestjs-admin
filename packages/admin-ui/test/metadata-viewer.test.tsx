/**
 * The metadata viewer.
 *
 * `/admin/meta` is the whole of what this interface knows, so "why does this
 * column look like that" is always answered there - and until now the only way
 * to look was the browser's network tab.
 *
 * What is asserted here is that it reads as a table rather than a blob, that it
 * costs nothing until somebody opens it, and that the raw document is one
 * button away for a bug report.
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

const model = {
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  can: { list: true, read: true, create: true, update: true, delete: true },
  actions: [],
  versionField: 'updatedAt',
  fields: [
    field('id', { isId: true, isGenerated: true, readOnly: true }),
    field('email', { isRequired: true, isUnique: true, widget: 'email' }),
    field('passwordHash', { writeOnly: true, widget: 'password' }),
    field('role', { kind: 'enum', enumValues: ['USER', 'ADMIN'] }),
    field('posts', {
      kind: 'relation',
      isList: true,
      relation: { targetModel: 'Post', cardinality: 'many', shape: 'one-to-many' },
    }),
  ],
}

function server() {
  const calls: string[] = []

  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    calls.push(path)

    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [model], capabilities: { useDevTools: true } } }
      : path === '/dev/doctor'
        ? { success: true, data: [] }
        : path === '/dev'
          ? {
              success: true,
              data: {
                models: [{ name: 'User', relations: 0, records: 0 }],
                totalRecords: 0,
                adapter: 'prisma',
                database: 'sqlite',
                environment: { deployed: false, because: [] },
                faker: false,
                images: false,
                history: [],
              },
            }
          : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } }

    return { status: 200, json: async () => body } as unknown as Response
  })

  return { calls }
}

async function openTools(): Promise<void> {
  window.location.hash = '#/~schema'
  render(<App />)
  await screen.findByRole('heading', { name: 'Schema' })
}

const expand = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: /Metadata/ }))
}

describe('before it is opened', () => {
  it('costs nothing', async () => {
    // A second copy of a document the shell already has. Fetching it on the
    // chance somebody expands a card would be a request per page view.
    const { calls } = server()
    await openTools()

    const metaCalls = calls.filter((path) => path.startsWith('/meta'))
    // Two: the shell's own, and the Schema page's. The viewer has not asked.
    expect(metaCalls).toHaveLength(2)
    expect(screen.queryByRole('table', { name: 'User fields' })).toBeNull()
  })
})

describe('once opened', () => {
  it('shows every field with what decides how it is drawn', async () => {
    server()
    await openTools()
    await expand()

    const table = await screen.findByRole('table', { name: 'User fields' })
    expect(table.textContent).toContain('passwordHash')
    expect(table.textContent).toContain('write-only')
    expect(table.textContent).toContain('password')
  })

  it('spells out an enum, which is what the form will offer', async () => {
    server()
    await openTools()
    await expand()

    expect(await screen.findByText(/USER, ADMIN/)).toBeTruthy()
  })

  it('says what a relation points at, and how', async () => {
    server()
    await openTools()
    await expand()

    expect(await screen.findByText('Post (one-to-many)')).toBeTruthy()
  })

  it('names the columns the server chose for this model', async () => {
    // Display field and version field are decided on the server; seeing which
    // ones it picked is the point of looking.
    server()
    await openTools()
    await expand()

    expect(await screen.findByText(/shown as: name/)).toBeTruthy()
    expect(screen.getByText(/version: updatedAt/)).toBeTruthy()
  })

  it('filters by model or field', async () => {
    server()
    await openTools()
    await expand()

    await screen.findByRole('table', { name: 'User fields' })
    fireEvent.change(screen.getByLabelText('Filter the metadata'), {
      target: { value: 'nothing-like-this' },
    })

    await waitFor(() => expect(screen.queryByRole('table', { name: 'User fields' })).toBeNull())
    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
  })

  it('offers the raw document, for a bug report', async () => {
    server()
    await openTools()
    await expand()

    expect(await screen.findByRole('button', { name: /Copy JSON/ })).toBeTruthy()
  })
})
