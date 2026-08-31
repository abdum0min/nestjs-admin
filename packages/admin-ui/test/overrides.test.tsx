/**
 * Labels, widgets, and not offering what will be refused.
 *
 * The interface used to show `New`, `Edit` and `Delete` to every principal,
 * including ones for whom all three returned 403 - the gap a consumer
 * walkthrough left
 * open. The metadata now says what the policy will allow, and these assert the
 * interface believes it.
 *
 * None of this is enforcement. Every request is checked again when it arrives;
 * hiding a button only stops the screen promising something the server will not
 * do.
 */
import { fireEvent, render, screen } from '@testing-library/react'
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

const ALL = { list: true, read: true, create: true, update: true, delete: true }

const userModel = (over: Record<string, unknown> = {}, fields: unknown[] = []) => ({
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  can: ALL,
  fields: [
    field('id', { isId: true, isGenerated: true, readOnly: true }),
    field('name'),
    ...fields,
  ],
  ...over,
})

const envelope = (data: unknown, meta?: unknown) => ({
  success: true,
  data,
  ...(meta ? { meta } : {}),
})

function server(models: unknown[], record: unknown = { id: 'u1', name: 'Ada' }): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    const body = path.startsWith('/meta')
      ? envelope({ models })
      : path.startsWith('/User/u1')
        ? envelope(record)
        : envelope([record], { total: 1, page: 1, perPage: 25 })
    return { status: 200, json: async () => body } as unknown as Response
  })
}

describe('what the principal may do', () => {
  it('offers the write controls when the policy allows them', async () => {
    server([userModel()])
    window.location.hash = '#/User/u1'
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  })

  it('withholds Edit and Delete when the policy refuses them', async () => {
    server([userModel({ can: { ...ALL, update: false, delete: false } })])
    window.location.hash = '#/User/u1'
    render(<App />)

    // The detail page names the record in its heading as well as in the
    // field list, so the plain text matches twice; the heading is the one.
    await screen.findByRole('heading', { name: 'Ada' })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('withholds New on the list when creating is refused', async () => {
    server([userModel({ can: { ...ALL, create: false } })])
    window.location.hash = '#/User'
    render(<App />)

    await screen.findByText('Ada')
    expect(screen.queryByRole('button', { name: /New/ })).toBeNull()
  })

  it('keeps offering them when the server says nothing', async () => {
    // A server that predates this field. Withholding on absence would break
    // every screen against an older backend.
    const { can, ...withoutPermissions } = userModel()
    void can
    server([withoutPermissions])
    window.location.hash = '#/User/u1'
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy()
  })
})

describe('labels', () => {
  it('uses the model label where the model name would go', async () => {
    server([userModel({ label: 'People' })])
    window.location.hash = '#/User'
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'People' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New People' })).toBeTruthy()
  })

  it('uses the field label in a form', async () => {
    server([userModel({}, [field('bio', { label: 'About this person' })])])
    window.location.hash = '#/User/new'
    render(<App />)

    expect(await screen.findByLabelText(/About this person/)).toBeTruthy()
  })
})

describe('widgets', () => {
  const inputFor = async (widget: string) => {
    server([userModel({}, [field('note', { widget })])])
    window.location.hash = '#/User/new'
    render(<App />)
    return screen.findByLabelText('note')
  }

  it('renders a textarea for prose', async () => {
    expect((await inputFor('textarea')).tagName).toBe('TEXTAREA')
  })

  it('renders a textarea for json, with spellcheck off', async () => {
    const input = await inputFor('json')

    expect(input.tagName).toBe('TEXTAREA')
    expect(input.getAttribute('spellcheck')).toBe('false')
  })

  for (const widget of ['password', 'email', 'url', 'color']) {
    it(`renders a ${widget} input`, async () => {
      expect((await inputFor(widget)).getAttribute('type')).toBe(widget)
    })
  }

  it('does not offer a password box to the visitor password manager', async () => {
    // The value belongs to the record being edited, not to whoever is editing.
    const input = await inputFor('password')

    expect(input.getAttribute('autocomplete')).toBe('new-password')
  })
})

describe('read-only fields', () => {
  it('are not editable', async () => {
    server([userModel({}, [field('slug', { readOnly: true })])])
    window.location.hash = '#/User/new'
    render(<App />)

    await screen.findByLabelText(/name/)
    expect(screen.queryByLabelText('slug')).toBeNull()
  })

  it('are still shown on the detail page', async () => {
    server([userModel({}, [field('slug', { readOnly: true })])], {
      id: 'u1',
      name: 'Ada',
      slug: 'ada',
    })
    window.location.hash = '#/User/u1'
    render(<App />)

    expect(await screen.findByText('ada')).toBeTruthy()
  })

  it('do not reach the request when a form is submitted', async () => {
    const sent: unknown[] = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (isSessionProbe(url)) return NO_LOGIN_ROUTES
      const path = String(url).replace('/admin', '')
      if (init?.method === 'POST') {
        sent.push(JSON.parse(String(init.body)))
        return { status: 201, json: async () => envelope({ id: 'u9' }) } as unknown as Response
      }
      return {
        status: 200,
        json: async () =>
          envelope({ models: [userModel({}, [field('slug', { readOnly: true })])] }),
      } as unknown as Response
    })

    window.location.hash = '#/User/new'
    render(<App />)

    fireEvent.change(await screen.findByLabelText(/name/), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).not.toHaveProperty('slug')
  })
})
