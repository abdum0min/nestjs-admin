/**
 * Component behaviour, driven by metadata.
 *
 * `fetch` is mocked; nothing else is. The point of each assertion is that the
 * rendered UI is a function of the metadata document — no model or field name
 * appears in the application source, so a schema the UI has never seen must
 * render correctly.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { isSessionProbe, NO_LOGIN_ROUTES } from './no-login.js'
import { optionsOf } from './radix.js'

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
  ...over,
})

const USER_MODEL = {
  name: 'User',
  primaryKey: ['id'],
  fields: [
    field('id', { isId: true, isGenerated: true }),
    field('email', { isUnique: true, isRequired: true }),
    field('active', { kind: 'boolean' }),
    field('role', { kind: 'enum', enumValues: ['USER', 'ADMIN'] }),
    field('bio'),
  ],
}

const POST_MODEL = { name: 'Post', primaryKey: ['id'], fields: [field('id', { isId: true })] }

/** Route every request by URL, so a screen can drive several endpoints. */
function routeFetch(handlers: Record<string, unknown>): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    const key = Object.keys(handlers).find((candidate) => path.startsWith(candidate))
    const body = key
      ? handlers[key]
      : { success: false, error: { code: 'MODEL_NOT_FOUND', message: 'x' } }
    return { status: 200, json: async () => body } as unknown as Response
  })
}

const metaOk = (models: unknown[]) => ({ success: true, data: { models } })
const listOk = (records: unknown[], total = records.length) => ({
  success: true,
  data: records,
  meta: { total, page: 1, perPage: 25 },
})

describe('metadata drives navigation', () => {
  it('shows a loading state first', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    render(<App />)

    expect(screen.getByRole('status').textContent).toMatch(/loading/i)
  })

  it('renders one nav entry per model returned', async () => {
    routeFetch({ '/meta': metaOk([USER_MODEL, POST_MODEL]) })
    render(<App />)

    const nav = await screen.findByRole('navigation', { name: /resources/i })
    expect(within(nav).getByRole('link', { name: 'User' })).toBeDefined()
    expect(within(nav).getByRole('link', { name: 'Post' })).toBeDefined()
  })

  it('does not show a model the server omitted', async () => {
    // Resource authorization hides models by leaving them out of metadata.
    // The UI needs no filtering of its own for that to work.
    routeFetch({ '/meta': metaOk([USER_MODEL]) })
    render(<App />)

    await screen.findByRole('link', { name: 'User' })
    expect(screen.queryByRole('link', { name: 'Post' })).toBeNull()
    expect(document.body.textContent).not.toContain('Post')
  })

  it('renders the empty state when no models are accessible', async () => {
    // A 200 with zero models is authorized-and-empty, not an error.
    routeFetch({ '/meta': metaOk([]) })
    render(<App />)

    expect(await screen.findByText(/no accessible resources/i)).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('metadata failures', () => {
  const failWith = (code: string, status: number) => {
    fetchMock.mockResolvedValue({
      status,
      json: async () => ({ success: false, error: { code, message: 'server said no' } }),
    } as unknown as Response)
  }

  it('shows an unauthenticated state on 401', async () => {
    failWith('UNAUTHORIZED', 401)
    render(<App />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/not signed in/i)
  })

  it('shows a forbidden state on 403', async () => {
    failWith('FORBIDDEN', 403)
    render(<App />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/no access/i)
  })

  it('shows a generic state on 500 and offers a retry', async () => {
    failWith('INTERNAL_ERROR', 500)
    render(<App />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/something went wrong/i)
    expect(within(alert).getByRole('button', { name: /try again/i })).toBeDefined()
  })

  it('offers no retry for an auth failure', async () => {
    failWith('UNAUTHORIZED', 401)
    render(<App />)

    const alert = await screen.findByRole('alert')
    expect(within(alert).queryByRole('button')).toBeNull()
  })
})

describe('the generic list', () => {
  beforeEach(() => {
    window.location.hash = '#/User'
  })

  it('builds columns from metadata, not from a hard-coded list', async () => {
    routeFetch({
      '/meta': metaOk([USER_MODEL]),
      '/User': listOk([{ id: 'u1', email: 'a@b.c', active: true, role: 'USER', bio: null }]),
    })
    render(<App />)

    const headers = await screen.findAllByRole('columnheader')
    // The last column holds the row's actions and is headed only for a screen
    // reader, so it has text but is not a field.
    const labels = headers
      .map((header) => header.textContent)
      .filter((label) => Boolean(label) && label !== 'Actions')

    expect(labels).toEqual(['id', 'email', 'active', 'role', 'bio'])
  })

  it('renders records', async () => {
    routeFetch({
      '/meta': metaOk([USER_MODEL]),
      '/User': listOk([
        { id: 'u1', email: 'ada@example.com', active: true, role: 'ADMIN', bio: null },
      ]),
    })
    render(<App />)

    expect(await screen.findByText('ada@example.com')).toBeDefined()
  })

  it('renders booleans, enums and nulls readably', async () => {
    routeFetch({
      '/meta': metaOk([USER_MODEL]),
      '/User': listOk([{ id: 'u1', email: 'a@b.c', active: false, role: 'USER', bio: null }]),
    })
    render(<App />)

    const row = (await screen.findByText('a@b.c')).closest('tr')
    expect(row).not.toBeNull()

    const cells = within(row as HTMLElement)
      .getAllByRole('cell')
      .map((cell) => cell.textContent)

    expect(cells).toContain('No') // boolean false, not "false"
    expect(cells).toContain('USER') // enum
    expect(cells).toContain('—') // null
    expect(cells.join(' ')).not.toContain('[object Object]')
  })

  it('shows an empty state when the model has no records', async () => {
    routeFetch({ '/meta': metaOk([USER_MODEL]), '/User': listOk([]) })
    render(<App />)

    // An empty table and an empty search result look the same and have
    // opposite remedies, so they say different things. This is the first.
    expect(await screen.findByText(/no user records yet/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /create the first one/i })).toBeTruthy()
  })

  it('offers to widen the view when a search excludes everything', async () => {
    routeFetch({ '/meta': metaOk([USER_MODEL]), '/User': listOk([]) })
    render(<App />)

    fireEvent.change(await screen.findByLabelText(/search user/i), {
      target: { value: 'zzzz' },
    })

    expect(await screen.findByText(/no user matches this search/i)).toBeDefined()
    // Not "create the first one": there may be thousands, none of them this.
    expect(screen.queryByRole('button', { name: /create the first one/i })).toBeNull()
    expect(screen.getByRole('button', { name: /clear search and filters/i })).toBeTruthy()
  })

  it('requests the model with pagination', async () => {
    routeFetch({ '/meta': metaOk([USER_MODEL]), '/User': listOk([]) })
    render(<App />)

    await screen.findByText(/no user records yet/i)

    const listCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/User'))
    const url = decodeURIComponent(String(listCall?.[0]))

    expect(url).toContain('page=1')
    expect(url).toContain('perPage=25')
    expect(url).not.toContain('[')
  })

  it('offers sort options built from metadata', async () => {
    routeFetch({ '/meta': metaOk([USER_MODEL]), '/User': listOk([]) })
    render(<App />)

    // A listbox rather than a native select now, so its options exist only
    // once it is open. What is asserted is unchanged: the choices come from
    // metadata rather than from anything written here.
    const options = await optionsOf(await screen.findByLabelText(/sort by/i))

    expect(options).toContain('email ascending')
    expect(options).toContain('email descending')
  })

  it('offers only fields the server can filter', async () => {
    const withRelation = {
      ...USER_MODEL,
      fields: [
        ...USER_MODEL.fields,
        field('posts', {
          kind: 'relation',
          isList: true,
          relation: { targetModel: 'Post', cardinality: 'many' },
        }),
      ],
    }
    routeFetch({ '/meta': metaOk([withRelation]), '/User': listOk([]) })
    render(<App />)

    const options = await optionsOf(await screen.findByLabelText(/filter field/i))

    // The server rejects filtering a relation, so it is never offered.
    expect(options).toContain('email')
    expect(options).not.toContain('posts')
  })
})

describe('a model the metadata does not contain', () => {
  it('is reported without claiming it exists', async () => {
    window.location.hash = '#/Secret'
    routeFetch({ '/meta': metaOk([USER_MODEL]) })
    render(<App />)

    expect(await screen.findByText(/not one of the resources you can access/i)).toBeDefined()
    // No request is made for a model the server never described.
    await waitFor(() => {
      expect(fetchMock.mock.calls.every((call) => !String(call[0]).includes('/Secret'))).toBe(true)
    })
  })
})

describe('the record detail view', () => {
  it('renders every field from metadata', async () => {
    window.location.hash = '#/User/u1'
    routeFetch({
      '/meta': metaOk([USER_MODEL]),
      '/User/u1': {
        success: true,
        data: { id: 'u1', email: 'ada@example.com', active: true, role: 'ADMIN', bio: null },
      },
    })
    render(<App />)

    expect(await screen.findByText('ada@example.com')).toBeDefined()
    for (const name of ['id', 'email', 'active', 'role', 'bio']) {
      expect(screen.getByText(name)).toBeDefined()
    }
  })
})

describe('the create form', () => {
  it('offers inputs for editable fields only', async () => {
    window.location.hash = '#/User/new'
    routeFetch({ '/meta': metaOk([USER_MODEL]) })
    render(<App />)

    // `id` is generated, so it is displayed elsewhere but never asked for.
    expect(await screen.findByLabelText('email *')).toBeDefined()
    expect(screen.getByLabelText('bio')).toBeDefined()
    expect(screen.queryByLabelText(/^id/)).toBeNull()
  })

  it('renders an enum as a select and a boolean as a checkbox', async () => {
    window.location.hash = '#/User/new'
    routeFetch({ '/meta': metaOk([USER_MODEL]) })
    render(<App />)

    const role = await screen.findByLabelText('role')
    expect(role.getAttribute('role')).toBe('combobox')
    expect(await optionsOf(role)).toEqual(['USER', 'ADMIN'])

    expect((screen.getByLabelText('active') as HTMLInputElement).type).toBe('checkbox')
  })
})
