/**
 * Duplicating a record, and filling a form.
 *
 * Two buttons that both answer "start this form somewhere other than empty",
 * from opposite directions: one copies a real record, the other invents one.
 * They share the pre-fill and nothing else, which is why they were built
 * together.
 *
 * The interesting part of duplicate is what it refuses to copy. A duplicate
 * carrying the original's unique column is a create the database rejects, and
 * the person is left clearing a field nobody told them about.
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

const ALL = { list: true, read: true, create: true, update: true, delete: true }

const model = (can = ALL) => ({
  name: 'Post',
  primaryKey: ['id'],
  displayField: 'title',
  can,
  actions: [],
  fields: [
    field('id', { isId: true, isGenerated: true, readOnly: true }),
    field('title'),
    field('slug', { isUnique: true }),
    field('body'),
  ],
})

const RECORD = { id: 'p1', title: 'The quiet harbour', slug: 'the-quiet-harbour', body: 'A body' }

function server(can = ALL, capabilities: Record<string, unknown> = {}) {
  const calls: string[] = []
  const bodies: string[] = []

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    if (typeof init?.body === 'string') bodies.push(init.body)

    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [model(can)], capabilities } }
      : path === '/dev/doctor'
        ? { success: true, data: [] }
        : path === '/dev/preview'
          ? {
              success: true,
              data: {
                model: 'Post',
                records: [{ title: 'Amber meadow', slug: 'amber-meadow-1x', body: 'Invented.' }],
              },
            }
          : path.startsWith('/Post/p1')
            ? { success: true, data: RECORD }
            : { success: true, data: [RECORD], meta: { total: 1, page: 1, perPage: 25 } }

    return { status: 200, json: async () => body } as unknown as Response
  })

  return { calls, bodies }
}

const value = (label: string | RegExp): string =>
  (screen.getByLabelText(label) as HTMLInputElement).value

describe('duplicating a record', () => {
  it('is offered on the record itself', async () => {
    server()
    window.location.hash = '#/Post/p1'
    render(<App />)

    const button = await screen.findByRole('button', { name: /Duplicate/ })
    fireEvent.click(button)

    await waitFor(() => expect(window.location.hash).toBe('#/Post/new?from=p1'))
  })

  it('is not offered to somebody who may not create', async () => {
    server({ ...ALL, create: false })
    window.location.hash = '#/Post/p1'
    render(<App />)

    await screen.findByRole('heading', { name: 'The quiet harbour' })
    expect(screen.queryByRole('button', { name: /Duplicate/ })).toBeNull()
  })

  it('opens a create form carrying the original values', async () => {
    server()
    window.location.hash = '#/Post/new?from=p1'
    render(<App />)

    await waitFor(() => expect(value(/Body/i)).toBe('A body'))
    expect(value(/Title/i)).toBe('The quiet harbour')
  })

  it('leaves the unique column empty, because a copy of it cannot be saved', async () => {
    // The whole difference between a duplicate that works and one that fails
    // on a constraint the person cannot see.
    server()
    window.location.hash = '#/Post/new?from=p1'
    render(<App />)

    await waitFor(() => expect(value(/Title/i)).toBe('The quiet harbour'))
    expect(value(/Slug/i)).toBe('')
  })

  it('creates rather than updating', async () => {
    const { calls } = server()
    window.location.hash = '#/Post/new?from=p1'
    render(<App />)

    await waitFor(() => expect(value(/Title/i)).toBe('The quiet harbour'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(calls).toContain('POST /Post'))
    expect(calls.some((call) => call.startsWith('PATCH'))).toBe(false)
  })

  it('survives a reload, because it lives in the address', async () => {
    // A half-filled duplicate is worth being able to send to somebody.
    server()
    window.location.hash = '#/Post/new?from=p1'
    render(<App />)

    await waitFor(() => expect(value(/Title/i)).toBe('The quiet harbour'))
  })
})

describe('filling a form with example data', () => {
  it('is offered only where the developer tools are', async () => {
    server(ALL, { useDevTools: false })
    window.location.hash = '#/Post/new'
    render(<App />)

    await screen.findByLabelText(/Title/i)
    expect(screen.queryByRole('button', { name: /Fill with example data/ })).toBeNull()
  })

  it('fills the boxes without writing anything', async () => {
    const { calls } = server(ALL, { useDevTools: true })
    window.location.hash = '#/Post/new'
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Fill with example data/ }))

    await waitFor(() => expect(value(/Title/i)).toBe('Amber meadow'))
    expect(value(/Body/i)).toBe('Invented.')
    // The generator's dry run: the same code path that writes, stopped short.
    expect(calls).toContain('POST /dev/preview')
    expect(calls).not.toContain('POST /Post')
  })

  it('is not offered while editing', async () => {
    // A button that discards somebody's record should not sit beside the one
    // that saves it.
    server(ALL, { useDevTools: true })
    window.location.hash = '#/Post/p1/edit'
    render(<App />)

    await waitFor(() => expect(value(/Title/i)).toBe('The quiet harbour'))
    expect(screen.queryByRole('button', { name: /Fill with example data/ })).toBeNull()
  })
})
