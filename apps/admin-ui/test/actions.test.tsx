/**
 * Application-defined buttons in the interface.
 *
 * The interface knows nothing about what any of them do - it draws what the
 * metadata describes and posts to a route. Everything asserted here is about
 * that contract: which button appears where, what a confirmation prevents, and
 * that the person pressing it is told what happened.
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

const userModel = (actions: unknown[]) => ({
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  can: ALL,
  actions,
  fields: [field('id', { isId: true, isGenerated: true, readOnly: true }), field('name')],
})

const envelope = (data: unknown, meta?: unknown) => ({
  success: true,
  data,
  ...(meta ? { meta } : {}),
})

function server(actions: unknown[]): { calls: string[] } {
  const calls: string[] = []

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)

    if (path.startsWith('/actions/')) {
      return {
        status: 201,
        json: async () => envelope({ message: 'Done, apparently.' }),
      } as unknown as Response
    }

    const body = path.startsWith('/meta')
      ? envelope({ models: [userModel(actions)] })
      : path.startsWith('/User/u1')
        ? envelope({ id: 'u1', name: 'Ada' })
        : envelope([{ id: 'u1', name: 'Ada' }], { total: 1, page: 1, perPage: 25 })

    return { status: 200, json: async () => body } as unknown as Response
  })

  return { calls }
}

const BAN = { name: 'ban', label: 'Ban', scope: 'record', danger: true }
const PURGE = { name: 'purge', label: 'Purge', scope: 'list' }

describe('where an action appears', () => {
  it('puts a record action on the detail page', async () => {
    server([BAN])
    window.location.hash = '#/User/u1'
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Ban' })).toBeTruthy()
  })

  it('keeps a record action off the list', async () => {
    server([BAN])
    window.location.hash = '#/User'
    render(<App />)

    await screen.findByText('Ada')
    expect(screen.queryByRole('button', { name: 'Ban' })).toBeNull()
  })

  it('puts a list action on the list', async () => {
    server([PURGE])
    window.location.hash = '#/User'
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Purge' })).toBeTruthy()
  })

  it('draws nothing when the model has none', async () => {
    // Which is also what happens when the policy refused them: the server
    // sends an empty list rather than a flag to interpret.
    server([])
    window.location.hash = '#/User/u1'
    render(<App />)

    // The detail page names the record in its heading as well as in the
    // field list, so the plain text matches twice; the heading is the one.
    await screen.findByRole('heading', { name: 'Ada' })
    expect(screen.queryByRole('button', { name: 'Ban' })).toBeNull()
  })
})

describe('running one', () => {
  it('posts to the action route with the record id', async () => {
    const { calls } = server([BAN])
    window.location.hash = '#/User/u1'
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ban' }))

    await waitFor(() => expect(calls).toContain('POST /actions/User/ban/u1'))
  })

  it('posts without an id for a list action', async () => {
    const { calls } = server([PURGE])
    window.location.hash = '#/User'
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Purge' }))

    await waitFor(() => expect(calls).toContain('POST /actions/User/purge'))
  })

  it('says what happened', async () => {
    server([PURGE])
    window.location.hash = '#/User'
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Purge' }))

    expect(await screen.findByText('Done, apparently.')).toBeTruthy()
  })

  it('says something even when the action said nothing', async () => {
    // Silence after a button press is indistinguishable from a button that did
    // not respond.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (isSessionProbe(url)) return NO_LOGIN_ROUTES
      const path = String(url).replace('/admin', '')
      if (path.startsWith('/actions/')) {
        return { status: 201, json: async () => envelope({}) } as unknown as Response
      }
      return {
        status: 200,
        json: async () =>
          path.startsWith('/meta')
            ? envelope({ models: [userModel([PURGE])] })
            : envelope([{ id: 'u1', name: 'Ada' }], { total: 1, page: 1, perPage: 25 }),
      } as unknown as Response
    })

    window.location.hash = '#/User'
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Purge' }))

    expect(await screen.findByText('Purge done.')).toBeTruthy()
  })

  it('re-reads the screen afterwards, because the action may have changed it', async () => {
    const { calls } = server([PURGE])
    window.location.hash = '#/User'
    render(<App />)

    await screen.findByText('Ada')
    const before = calls.filter((call) => call.startsWith('GET /User?')).length

    fireEvent.click(screen.getByRole('button', { name: 'Purge' }))

    await waitFor(() =>
      expect(calls.filter((call) => call.startsWith('GET /User?')).length).toBeGreaterThan(before),
    )
  })
})

describe('confirmation', () => {
  const WITH_CONFIRM = { ...BAN, confirm: 'Ban this user?' }

  it('asks before sending', async () => {
    // The question is a real dialog now rather than `window.confirm`, so
    // answering it means pressing something. What it asks is still the
    // application's own `confirm` string, verbatim.
    const { calls } = server([WITH_CONFIRM])

    window.location.hash = '#/User/u1'
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ban' }))

    const box = await screen.findByRole('alertdialog')
    expect(box.textContent).toContain('Ban this user?')
    expect(calls).not.toContain('POST /actions/User/ban/u1')

    fireEvent.click(within(box).getByRole('button', { name: 'Ban' }))
    await waitFor(() => expect(calls).toContain('POST /actions/User/ban/u1'))
  })

  it('sends nothing when the answer is no', async () => {
    const { calls } = server([WITH_CONFIRM])

    window.location.hash = '#/User/u1'
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ban' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    )

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls.some((call) => call.startsWith('POST /actions'))).toBe(false)
  })

  it('does not ask when no confirmation was declared', async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    server([PURGE])

    window.location.hash = '#/User'
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Purge' }))

    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('when it fails', () => {
  it('shows the server message for a refusal', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (isSessionProbe(url)) return NO_LOGIN_ROUTES
      const path = String(url).replace('/admin', '')
      if (path.startsWith('/actions/')) {
        return {
          status: 400,
          json: async () => ({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Nothing to purge.' },
          }),
        } as unknown as Response
      }
      return {
        status: 200,
        json: async () =>
          path.startsWith('/meta')
            ? envelope({ models: [userModel([PURGE])] })
            : envelope([{ id: 'u1', name: 'Ada' }], { total: 1, page: 1, perPage: 25 }),
      } as unknown as Response
    })

    window.location.hash = '#/User'
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Purge' }))

    expect(await screen.findByText('Nothing to purge.')).toBeTruthy()
  })
})
