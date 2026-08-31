/**
 * The parts of the interface that only some people can see.
 *
 * Not an audit - a linter cannot tell whether a label says anything useful, and
 * neither can a test. What is asserted here is the handful of things that are
 * easy to break silently, because nothing looks wrong when they are broken: a
 * control with no name, a table with no name, a skip link that navigates
 * instead of skipping, a state nobody is told about.
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

const MODELS = ['User', 'Post', 'Tag'].map((name) => ({
  name,
  primaryKey: ['id'],
  displayField: 'name',
  can: { list: true, read: true, create: true, update: true, delete: true },
  fields: [field('id', { isId: true, isGenerated: true, readOnly: true }), field('name')],
}))

function server(records: unknown[] = [{ id: 'u1', name: 'Ada' }]) {
  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES

    return {
      status: 200,
      json: async () =>
        String(url).includes('/meta')
          ? { success: true, data: { models: MODELS } }
          : { success: true, data: records, meta: { total: records.length, page: 1, perPage: 25 } },
    } as unknown as Response
  })
}

async function openList(): Promise<void> {
  window.location.hash = '#/User'
  render(<App />)
  await screen.findByRole('table')
}

describe('the skip link', () => {
  it('moves focus to the content instead of navigating', async () => {
    // A fragment link would work in an ordinary page and break this one: the
    // route lives in the hash, so `#main` would be read as a destination.
    server()
    await openList()
    const before = window.location.hash

    fireEvent.click(screen.getByRole('button', { name: /skip to content/i }))

    expect(document.activeElement).toBe(document.getElementById('admin-main'))
    expect(window.location.hash).toBe(before)
  })

  it('leaves the content out of the tab order otherwise', async () => {
    // `tabIndex="-1"` is focusable but not tabbable. `0` would insert a stop
    // that nobody asked for on every page.
    server()
    await openList()

    expect(document.getElementById('admin-main')?.getAttribute('tabindex')).toBe('-1')
  })
})

describe('names for things that have none by default', () => {
  it('names the table', async () => {
    // A detail page shows related records beside the record itself, so "table"
    // alone does not say which one a reader has landed in.
    server()
    await openList()

    expect(screen.getByRole('table', { name: 'User' })).toBeTruthy()
  })

  it('names the search box and every control in the toolbar', async () => {
    server()
    await openList()

    expect(screen.getByLabelText('Search User')).toBeTruthy()
    expect(screen.getByLabelText('Sort by')).toBeTruthy()
    expect(screen.getByLabelText('Filter field')).toBeTruthy()
  })

  it('marks the resource you are looking at', async () => {
    server()
    await openList()

    expect(screen.getByRole('link', { name: 'User' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Post' }).hasAttribute('aria-current')).toBe(false)
  })
})

describe('states a reader is told about rather than shown', () => {
  it('announces the first load', async () => {
    server()
    window.location.hash = '#/User'
    render(<App />)

    expect((await screen.findByRole('status')).textContent).toMatch(/loading/i)
  })

  it('marks the table busy while it is being replaced', async () => {
    // The rows stay on screen and dim. Dimming is invisible to a reader, so
    // the same fact is stated in the markup.
    //
    // The second list response is held open deliberately: the window being
    // asserted is the one where a request is in flight, and against an instant
    // mock that window closes before anything can look at it.
    let release: (() => void) | undefined
    let listCalls = 0

    fetchMock.mockImplementation(async (url: string) => {
      if (isSessionProbe(url)) return NO_LOGIN_ROUTES

      const body = String(url).includes('/meta')
        ? { success: true, data: { models: MODELS } }
        : {
            success: true,
            data: [{ id: 'u1', name: 'Ada' }],
            meta: { total: 1, page: 1, perPage: 25 },
          }

      if (!String(url).includes('/meta') && ++listCalls > 1) {
        await new Promise<void>((resolve) => (release = resolve))
      }
      return { status: 200, json: async () => body } as unknown as Response
    })

    await openList()
    fireEvent.change(screen.getByLabelText('Search User'), { target: { value: 'ada' } })

    await vi.waitFor(() => {
      expect(screen.getByRole('table').parentElement?.getAttribute('aria-busy')).toBe('true')
    })
    // Still showing the previous rows, rather than a blank screen.
    expect(screen.getByText('Ada')).toBeTruthy()

    release?.()
    await vi.waitFor(() => {
      expect(screen.getByRole('table').parentElement?.hasAttribute('aria-busy')).toBe(false)
    })
  })

  it('announces a failure rather than only colouring it', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (isSessionProbe(url)) return NO_LOGIN_ROUTES

      return {
        status: String(url).includes('/meta') ? 200 : 500,
        json: async () =>
          String(url).includes('/meta')
            ? { success: true, data: { models: MODELS } }
            : { success: false, error: { code: 'INTERNAL_ERROR', message: 'Nope.' } },
      } as unknown as Response
    })

    window.location.hash = '#/User'
    render(<App />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/something went wrong/i)
  })
})
