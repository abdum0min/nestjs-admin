/**
 * The import and export dialogs.
 *
 * The export half is mostly about one thing: that the file follows the screen.
 * The import half is about the step that cannot be skipped - nothing is written
 * until somebody has seen a plan, because there is no transaction behind it and
 * a half-finished import is only acceptable when its errors were known first.
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
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:x',
    revokeObjectURL: () => undefined,
  })
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
  actions: [],
  fields: [
    field('id', { isId: true, isGenerated: true, readOnly: true }),
    field('email', { isUnique: true, isRequired: true }),
    field('name'),
    field('posts', {
      kind: 'relation',
      isList: true,
      relation: { targetModel: 'Post', cardinality: 'many' },
    }),
  ],
}

const SHAPE = {
  columns: ['Email', 'Name'],
  rows: 2,
  truncated: false,
  targets: [
    { field: 'email', kind: 'string', required: true, unique: true },
    { field: 'name', kind: 'string', required: false, unique: false },
  ],
  matchable: ['id', 'email'],
  mapping: { email: 'Email', name: 'Name' },
  sample: [{ Email: 'ada@example.com', Name: 'Ada' }],
}

const PLAN = {
  matchBy: 'email',
  mapping: { name: 'Name' },
  create: 1,
  update: 1,
  refused: 1,
  rows: [
    { line: 2, action: 'create', values: { email: 'new@example.com', name: 'New' }, problems: [] },
    { line: 3, action: 'update', id: 'u1', values: { name: 'Ada L' }, problems: [] },
    { line: 4, action: 'refused', values: {}, problems: ['age: "forty" is not a number.'] },
  ],
}

function server(capabilities: Record<string, unknown> = {}) {
  const calls: string[] = []

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)

    if (path.startsWith('/export/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="User-2026-09-06.csv"',
        }),
        blob: async () => new Blob(['id,name\r\n']),
      } as unknown as Response
    }

    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [MODEL], capabilities } }
      : path.includes('/import/User/columns')
        ? { success: true, data: SHAPE }
        : path.includes('/import/User/plan')
          ? { success: true, data: PLAN }
          : path.includes('/import/User')
            ? { success: true, data: { created: 1, updated: 1, failed: [] } }
            : {
                success: true,
                data: [{ id: 'u1', email: 'ada@example.com', name: 'Ada' }],
                meta: { total: 1, page: 1, perPage: 25 },
              }

    return { status: 200, ok: true, json: async () => body } as unknown as Response
  })

  return calls
}

/** Choose a file, the way the dialog's hidden input receives one. */
function choose(text: string, name = 'people.csv'): void {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File([text], name, { type: 'text/csv' })
  // jsdom's File has no `text()` in every version; the dialog reads the file
  // with it, so the stand-in has to have one.
  Object.defineProperty(file, 'text', { value: async () => text })

  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

const openList = async (capabilities: Record<string, unknown> = {}) => {
  const calls = server(capabilities)
  window.location.hash = '#/User'
  render(<App />)
  await screen.findByRole('button', { name: /New User/ })
  return calls
}

describe('export', () => {
  it('is offered on the list', async () => {
    await openList()
    expect(screen.getByRole('button', { name: /Export/ })).toBeTruthy()
  })

  it('is absent for a role the server says may not export', async () => {
    await openList({ exportData: false })
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull()
  })

  /*
   * A server older than this feature sends no capability at all. Hiding a
   * working button because a field is missing would be the wrong way round.
   */
  it('is offered when the server says nothing about it', async () => {
    await openList({})
    expect(screen.getByRole('button', { name: /Export/ })).toBeTruthy()
  })

  it('offers every column, including one the table does not show', async () => {
    await openList()
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))

    await screen.findByText('Export User')
    expect(screen.getByLabelText('id')).toBeTruthy()
    expect(screen.getByLabelText('email')).toBeTruthy()
    // A to-many relation is a page of other records, not a cell.
    expect(screen.queryByLabelText('posts')).toBeNull()
  })

  it('asks the server for the columns that are ticked, in the model order', async () => {
    const calls = await openList()
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    await screen.findByText('Export User')

    fireEvent.click(screen.getByLabelText('email'))
    fireEvent.click(screen.getByRole('button', { name: /Download/ }))

    await waitFor(() => {
      const call = calls.find((entry) => entry.includes('/export/'))
      expect(call).toContain('columns=id%2Cname')
    })
  })

  it('carries the search on the screen into the file', async () => {
    const calls = await openList()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ada' } })
    await waitFor(() => expect(calls.some((entry) => entry.includes('search=ada'))).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    await screen.findByText('Export User')
    fireEvent.click(screen.getByRole('button', { name: /Download/ }))

    await waitFor(() => {
      const call = calls.find((entry) => entry.includes('/export/'))
      expect(call).toContain('search=ada')
    })
  })
})

describe('import', () => {
  it('asks the server what is in the file, and shows the guessed mapping', async () => {
    await openList()
    fireEvent.click(screen.getByRole('button', { name: /Import/ }))

    await screen.findByText(/Choose a file/)
    choose('Email,Name\r\nada@example.com,Ada\r\n')

    await screen.findByText(/people\.csv/)
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/2 rows, 2 columns/)).toBeTruthy()
    // The sample, so the mapping can be checked against a real value rather
    // than against a column name that sounded right.
    expect(dialog.getByText('ada@example.com')).toBeTruthy()
  })

  /* The whole point: no route that writes is called before a plan is shown. */
  it('writes nothing before the dry run has been seen', async () => {
    const calls = await openList()
    fireEvent.click(screen.getByRole('button', { name: /Import/ }))
    await screen.findByText(/Choose a file/)
    choose('Email,Name\r\nada@example.com,Ada\r\n')

    await screen.findByText(/people\.csv/)
    fireEvent.click(screen.getByRole('button', { name: /Check the file/ }))

    await screen.findByText('1 to create')
    expect(calls.filter((entry) => /POST \/import\/User(\?|$)/.test(entry))).toHaveLength(0)
  })

  it('shows what is wrong, with the line a spreadsheet would show', async () => {
    await openList()
    fireEvent.click(screen.getByRole('button', { name: /Import/ }))
    await screen.findByText(/Choose a file/)
    choose('Email,Name\r\nada@example.com,Ada\r\n')

    await screen.findByText(/people\.csv/)
    fireEvent.click(screen.getByRole('button', { name: /Check the file/ }))

    await screen.findByText('1 refused')
    expect(screen.getByText('Line 4')).toBeTruthy()
    expect(screen.getByText(/"forty" is not a number/)).toBeTruthy()
  })

  it('imports only after that, and reports both halves', async () => {
    const calls = await openList()
    fireEvent.click(screen.getByRole('button', { name: /Import/ }))
    await screen.findByText(/Choose a file/)
    choose('Email,Name\r\nada@example.com,Ada\r\n')

    await screen.findByText(/people\.csv/)
    fireEvent.click(screen.getByRole('button', { name: /Check the file/ }))

    await screen.findByText('1 to create')
    fireEvent.click(screen.getByRole('button', { name: /Import 2 records/ }))

    await screen.findByText(/1 created, 1 updated/)
    expect(calls.some((entry) => /POST \/import\/User\?/.test(entry))).toBe(true)
  })

  it('sends the mapping and the match column it was given', async () => {
    const calls = await openList()
    fireEvent.click(screen.getByRole('button', { name: /Import/ }))
    await screen.findByText(/Choose a file/)
    choose('Email,Name\r\nada@example.com,Ada\r\n')

    await screen.findByText(/people\.csv/)
    fireEvent.click(screen.getByRole('button', { name: /Check the file/ }))

    await screen.findByText('1 to create')
    const plan = calls.find((entry) => entry.includes('/import/User/plan')) as string

    expect(plan).toContain('mapping=email%3AEmail%2Cname%3AName')
    expect(plan).toContain('matchBy=email')
  })
})
