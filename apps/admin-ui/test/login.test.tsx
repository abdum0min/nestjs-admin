/**
 * The gate in front of the admin.
 *
 * Three situations, and the one that is easy to get wrong is the third: an
 * application that brought its own authentication must never be shown a sign-in
 * form by a package it asked to stay out of authentication.
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
    fields: [field('id', { isId: true, isGenerated: true, readOnly: true }), field('name')],
  },
]

const ACCOUNT = { id: 'acc_1', email: 'admin@example.com', name: 'Ada Admin' }

/**
 * An admin with a login of its own.
 *
 * `session` is what `GET /auth/session` answers before anything happens;
 * `accepts` decides whether a sign-in succeeds.
 */
function server({
  session = null,
  accepts = true,
}: { session?: typeof ACCOUNT | null; accepts?: boolean } = {}) {
  const calls: string[] = []
  let current = session

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace('/admin', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)

    if (path === '/auth/session') {
      return { status: 200, json: async () => ({ success: true, data: { account: current } }) }
    }

    if (path === '/auth/login') {
      if (!accepts) {
        return {
          status: 401,
          json: async () => ({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Those details do not match an account.' },
          }),
        }
      }
      current = ACCOUNT
      return { status: 200, json: async () => ({ success: true, data: { account: ACCOUNT } }) }
    }

    if (path === '/auth/logout') {
      current = null
      return { status: 200, json: async () => ({ success: true, data: { account: null } }) }
    }

    return {
      status: 200,
      json: async () =>
        path.startsWith('/meta')
          ? { success: true, data: { models: MODELS } }
          : {
              success: true,
              data: [{ id: 'u1', name: 'Ada' }],
              meta: { total: 1, page: 1, perPage: 25 },
            },
    }
  })

  return { calls }
}

const signInWith = (email: string, password: string): void => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('nobody signed in', () => {
  it('shows the sign-in screen and nothing else', async () => {
    // Not a banner over the admin, and not a redirect a determined URL can
    // skip past: the rest of the interface does not render at all.
    server()
    window.location.hash = '#/User'
    render(<App />)

    await screen.findByRole('button', { name: 'Sign in' })
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Resources' })).toBeNull()
  })

  it('does not ask for the schema before it knows who is asking', async () => {
    const { calls } = server()
    window.location.hash = '#/User'
    render(<App />)

    await screen.findByRole('button', { name: 'Sign in' })
    expect(calls.some((call) => call.includes('/meta'))).toBe(false)
  })

  it('signs in and opens the admin', async () => {
    server()
    window.location.hash = '#/User'
    render(<App />)
    await screen.findByRole('button', { name: 'Sign in' })

    signInWith('admin@example.com', 'hunter2')

    /*
     * Four sequential round trips: login, then the session it establishes,
     * then the schema, then the rows. Testing Library waits one second by
     * default, which is a guess about how fast the machine is rather than a
     * statement about correctness - and it is not enough for this chain when
     * the whole suite is running in parallel. The assertion is unchanged; only
     * the patience is.
     */
    await screen.findByRole('table', {}, { timeout: 4000 })
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })

  it('shows what the server said, and keeps the address typed', async () => {
    // Retyping an address you already typed correctly is the most annoying
    // part of getting a password wrong. The password is cleared; the email is
    // not.
    server({ accepts: false })
    render(<App />)
    await screen.findByRole('button', { name: 'Sign in' })

    signInWith('admin@example.com', 'wrong')

    expect((await screen.findByRole('alert')).textContent).toMatch(/do not match an account/)
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('admin@example.com')
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
  })

  it(`offers the password to a manager as the visitor own credential`, async () => {
    // The opposite of a password field on somebody's record. Here the
    // credential really is the person signing in.
    server()
    render(<App />)
    await screen.findByRole('button', { name: 'Sign in' })

    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('username')
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password')
  })

  it('masks the password, with a way to check it', async () => {
    server()
    render(<App />)
    await screen.findByRole('button', { name: 'Sign in' })

    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('text')
  })
})

describe('already signed in', () => {
  it('goes straight to the admin', async () => {
    server({ session: ACCOUNT })
    window.location.hash = '#/User'
    render(<App />)

    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })

  it('says whose session it is', async () => {
    // An admin with no visible sign of that has caught people out on a shared
    // machine.
    server({ session: ACCOUNT })
    window.location.hash = '#/User'
    render(<App />)
    await screen.findByRole('table')

    expect(screen.getByRole('button', { name: /signed in as Ada Admin/i })).toBeTruthy()
  })

  it('offers a way out, and takes it', async () => {
    const { calls } = server({ session: ACCOUNT })
    window.location.hash = '#/User'
    render(<App />)
    await screen.findByRole('table')

    fireEvent.keyDown(screen.getByRole('button', { name: /signed in as/i }), { key: 'Enter' })
    const menu = await screen.findByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /sign out/i }))

    await screen.findByRole('button', { name: 'Sign in' })
    expect(calls).toContain('POST /auth/logout')
  })

  it('returns to the sign-in screen when the session expires under it', async () => {
    /*
     * The screen that finds out is whichever one happened to make a request.
     * Each of them showing "not signed in" in its own corner is worse than
     * useless: the person is signed out and the page is still pretending to be
     * an admin.
     */
    server({ session: ACCOUNT })
    window.location.hash = '#/User'
    render(<App />)
    await screen.findByRole('table')

    // The next request comes back unauthenticated, as it would once the cookie
    // has expired.
    fetchMock.mockImplementation(async () => ({
      status: 401,
      json: async () => ({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' },
      }),
    }))

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'anything' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy())
  })
})

describe('an admin whose application brought its own authentication', () => {
  it('is never shown a sign-in form', async () => {
    /*
     * The login routes answer 404 there, which is not a failure - it is the
     * package staying out of an identity system it was asked to stay out of.
     * Showing a form nobody can use would be worse than showing nothing.
     */
    fetchMock.mockImplementation(async (url: string) => {
      if (isSessionProbe(url)) return NO_LOGIN_ROUTES
      return {
        status: 200,
        json: async () =>
          String(url).includes('/meta')
            ? { success: true, data: { models: MODELS } }
            : {
                success: true,
                data: [{ id: 'u1', name: 'Ada' }],
                meta: { total: 1, page: 1, perPage: 25 },
              },
      }
    })

    window.location.hash = '#/User'
    render(<App />)

    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })

  it('is not offered a sign-out button it cannot honour', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (isSessionProbe(url)) return NO_LOGIN_ROUTES
      return {
        status: 200,
        json: async () =>
          String(url).includes('/meta')
            ? { success: true, data: { models: MODELS } }
            : {
                success: true,
                data: [{ id: 'u1', name: 'Ada' }],
                meta: { total: 1, page: 1, perPage: 25 },
              },
      }
    })

    window.location.hash = '#/User'
    render(<App />)
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: /signed in as/i })).toBeNull()
  })
})
