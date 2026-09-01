/**
 * The team screen.
 *
 * The rules live on the server, and this suite is careful not to re-test them:
 * what it checks is that the interface asks the right questions and does not
 * offer controls whose only outcome is a refusal.
 *
 * The one thing that matters most here is the row for the account doing the
 * looking. Suspending or removing yourself is refused by the server, so
 * offering the buttons would produce a page where two of them always fail.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { isSessionProbe } from './no-login.js'

const fetchMock = vi.fn()

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const ACCOUNT = { id: 'a1', email: 'owner@test', name: 'Owner', role: 'owner' }

const MEMBERS = [
  { id: 'a1', email: 'owner@test', name: 'Owner', role: 'owner', disabled: false, isYou: true },
  { id: 'a2', email: 'mate@test', name: 'Mate', role: 'editor', disabled: false, isYou: false },
  { id: 'a3', email: 'gone@test', name: 'Gone', role: 'editor', disabled: true, isYou: false },
]

/** A signed-in admin whose server answers the team routes. */
function server(
  options: {
    manageTeam?: boolean
    writable?: boolean
    onWrite?: (method: string, url: string, body: unknown) => void
  } = {},
) {
  const { manageTeam = true, writable = true, onWrite } = options

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url)
    const method = init?.method ?? 'GET'

    if (isSessionProbe(path)) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true, data: { account: ACCOUNT } }),
      }
    }

    if (path.includes('/dashboard')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true, data: { widgets: [], generated: false } }),
      }
    }

    if (path.includes('/team')) {
      if (method !== 'GET') {
        onWrite?.(
          method,
          path,
          init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        )
        return { status: 200, ok: true, json: async () => ({ success: true, data: MEMBERS[1] }) }
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          data: { members: MEMBERS, writable, roles: ['owner', 'editor'] },
        }),
      }
    }

    // Metadata: one model, plus whether this principal may open the team.
    return {
      status: 200,
      ok: true,
      json: async () => ({
        success: true,
        data: {
          capabilities: { manageTeam },
          models: [
            {
              name: 'User',
              primaryKey: ['id'],
              displayField: 'name',
              can: { list: true, read: true, create: true, update: true, delete: true },
              fields: [
                {
                  name: 'id',
                  kind: 'string',
                  isId: true,
                  isRequired: false,
                  isUnique: false,
                  isList: false,
                  isGenerated: false,
                  readOnly: false,
                },
              ],
            },
          ],
        },
      }),
    }
  })
}

const openTeam = () => {
  window.location.hash = '#/~team'
}

describe('reaching it', () => {
  it('offers the link when the server says the role may manage the team', async () => {
    server()
    render(<App />)

    fireEvent.keyDown(await screen.findByRole('button', { name: /Signed in as/i }), {
      key: 'Enter',
    })
    expect(await screen.findByRole('menuitem', { name: 'Team' })).toBeTruthy()
  })

  it('does not offer it otherwise', async () => {
    server({ manageTeam: false })
    render(<App />)

    fireEvent.keyDown(await screen.findByRole('button', { name: /Signed in as/i }), {
      key: 'Enter',
    })
    await screen.findByText('Sign out')
    expect(screen.queryByRole('menuitem', { name: 'Team' })).toBeNull()
  })

  it('uses a route no model name can collide with', async () => {
    server()
    render(<App />)

    fireEvent.keyDown(await screen.findByRole('button', { name: /Signed in as/i }), {
      key: 'Enter',
    })
    const link = await screen.findByRole('menuitem', { name: 'Team' })
    // `#/Team` would be a model called Team. The tilde cannot start one.
    expect(link.getAttribute('href')).toBe('#/~team')
  })
})

describe('the list', () => {
  it('shows each account with its role and status', async () => {
    server()
    openTeam()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Team' })).toBeTruthy()
    expect(screen.getByText('mate@test')).toBeTruthy()
    expect(screen.getByText('Suspended')).toBeTruthy()
  })

  it('marks the row belonging to whoever is looking', async () => {
    server()
    openTeam()
    render(<App />)

    const you = (await screen.findByText('Owner')).closest('tr')!
    expect(within(you).getByText('you')).toBeTruthy()
  })

  it('offers no suspend or remove on your own row', async () => {
    // The server refuses both, so a button here could only ever fail.
    server()
    openTeam()
    render(<App />)

    await screen.findByRole('heading', { name: 'Team' })

    expect(screen.queryByRole('button', { name: /Suspend owner@test/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove owner@test/ })).toBeNull()

    // And they are there for somebody else, so the absence above is about the
    // row rather than about the buttons never being rendered.
    expect(screen.getByRole('button', { name: /Suspend mate@test/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Remove mate@test/ })).toBeTruthy()
  })

  it('hides every control when the store cannot be written', async () => {
    server({ writable: false })
    openTeam()
    render(<App />)

    await screen.findByRole('heading', { name: 'Team' })

    expect(screen.queryByRole('button', { name: 'Add someone' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove mate@test/ })).toBeNull()
    expect(screen.getByText(/read-only/i)).toBeTruthy()
  })
})

describe('changing somebody', () => {
  it('suspends an account through the API', async () => {
    const writes: Array<{ method: string; body: unknown }> = []
    server({ onWrite: (method, _url, body) => writes.push({ method, body }) })
    openTeam()
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Suspend mate@test/ }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ method: 'PATCH', body: { disabled: true } })
  })

  it('sends a password rather than anything derived from one', async () => {
    // The whole reason this screen exists rather than a CRUD model: a hash is
    // never something a client supplies.
    const writes: Array<{ body: unknown }> = []
    server({ onWrite: (_method, _url, body) => writes.push({ body }) })
    openTeam()
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add someone' }))

    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'new@test' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-long-enough-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    const body = writes[0]!.body as Record<string, unknown>
    expect(body['password']).toBe('a-long-enough-password')
    expect(body).not.toHaveProperty('passwordHash')
  })

  it('does not offer a role selector on your own row', async () => {
    server()
    openTeam()
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Edit owner@test/ }))
    await screen.findByText('Edit account')

    expect(screen.queryByLabelText('Role')).toBeNull()
    // Present for somebody else, so this is about the row.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: /Edit mate@test/ }))
    expect(await screen.findByLabelText('Role')).toBeTruthy()
  })
})
