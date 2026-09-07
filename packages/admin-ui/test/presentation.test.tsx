/**
 * The screens the application can arrange: the sidebar, and the record.
 *
 * The layout itself is not worth asserting - a heading in the right place is
 * something you look at. What is worth asserting is the two promises made
 * around it: that no arrangement can hide a field, and that no arrangement can
 * hide the reason a form will not save.
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
  try {
    window.localStorage.clear()
  } catch {
    // A browser refusing storage is not a reason to skip the test.
  }
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

const post = (over: Record<string, unknown> = {}) => ({
  name: 'Post',
  primaryKey: ['id'],
  displayField: 'title',
  can: ALL,
  actions: [],
  fields: [
    field('id', { isId: true, isGenerated: true, readOnly: true }),
    field('title'),
    field('body'),
    field('note'),
  ],
  ...over,
})

const user = {
  name: 'User',
  primaryKey: ['id'],
  displayField: 'email',
  can: ALL,
  actions: [],
  fields: [field('id', { isId: true, isGenerated: true, readOnly: true }), field('email')],
}

const RECORD = { id: 'p1', title: 'The quiet harbour', body: 'A body', note: 'A note' }

function server({
  models = [post()],
  navigation,
  onWrite,
}: {
  models?: readonly unknown[]
  navigation?: readonly unknown[]
  onWrite?: () => { status: number; body: unknown }
} = {}) {
  const calls: string[] = []

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${path}`)

    if (method === 'PATCH' || method === 'POST') {
      const answer = onWrite?.() ?? { status: 200, body: { success: true, data: RECORD } }
      return {
        status: answer.status,
        ok: answer.status < 400,
        json: async () => answer.body,
      } as never
    }

    const body = path.startsWith('/meta')
      ? {
          success: true,
          data: { models, capabilities: {}, ...(navigation ? { navigation } : {}) },
        }
      : path.startsWith('/Post/p1')
        ? { success: true, data: RECORD }
        : { success: true, data: [RECORD], meta: { total: 1, page: 1, perPage: 25 } }

    return { status: 200, ok: true, json: async () => body } as unknown as Response
  })

  return calls
}

describe('the sidebar', () => {
  it('is one flat list when the application grouped nothing', async () => {
    server({ models: [post(), user] })
    window.location.hash = '#/Post'
    render(<App />)

    await screen.findByRole('heading', { name: 'Post' })
    expect(screen.queryByRole('button', { name: /Content/ })).toBeNull()
  })

  it('draws the headings it was given', async () => {
    server({
      models: [post(), user],
      navigation: [
        { kind: 'group', heading: 'Content', models: ['Post'] },
        { kind: 'group', heading: 'People', models: ['User'] },
      ],
    })
    window.location.hash = '#/Post'
    render(<App />)

    await screen.findByRole('heading', { name: 'Post' })
    expect(screen.getAllByRole('button', { name: /Content/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /People/ }).length).toBeGreaterThan(0)
  })

  it('folds a group, and keeps the one holding the open model', async () => {
    server({
      models: [post(), user],
      navigation: [
        { kind: 'group', heading: 'Content', models: ['Post'] },
        { kind: 'group', heading: 'People', models: ['User'] },
      ],
    })
    window.location.hash = '#/Post'
    render(<App />)

    const nav = within(await screen.findByRole('navigation', { name: 'Resources' }))
    expect(nav.getAllByRole('link', { name: 'User' }).length).toBe(1)

    fireEvent.click(nav.getByRole('button', { name: /People/ }))
    await waitFor(() => expect(nav.queryByRole('link', { name: 'User' })).toBeNull())

    // The group holding the page somebody is looking at never folds: hiding it
    // would remove the only thing saying where they are.
    fireEvent.click(nav.getByRole('button', { name: /Content/ }))
    expect(nav.getAllByRole('link', { name: 'Post' }).length).toBe(1)
  })

  it('draws a link out, and opens it in a new tab', async () => {
    server({
      models: [post()],
      navigation: [
        { kind: 'group', heading: 'Content', models: ['Post'] },
        { kind: 'link', label: 'Docs', href: 'https://example.com', external: true },
      ],
    })
    window.location.hash = '#/Post'
    render(<App />)

    const nav = within(await screen.findByRole('navigation', { name: 'Resources' }))
    const link = nav.getByRole('link', { name: 'Docs' })

    expect(link.getAttribute('href')).toBe('https://example.com')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })
})

describe('the record screen', () => {
  it('puts what you can do to a record in a column beside it', async () => {
    server()
    window.location.hash = '#/Post/p1'
    render(<App />)

    const rail = within(await screen.findByRole('complementary'))
    expect(rail.getByRole('button', { name: /Edit/ })).toBeTruthy()
    expect(rail.getByRole('button', { name: /Duplicate/ })).toBeTruthy()
    expect(rail.getByRole('button', { name: /Delete/ })).toBeTruthy()
  })

  it('offers nothing the policy would refuse', async () => {
    server({ models: [post({ can: { ...ALL, update: false, delete: false } })] })
    window.location.hash = '#/Post/p1'
    render(<App />)

    const rail = within(await screen.findByRole('complementary'))
    expect(rail.queryByRole('button', { name: /Edit/ })).toBeNull()
    expect(rail.queryByRole('button', { name: /Delete/ })).toBeNull()
  })

  it('shows every field when the application grouped none', async () => {
    server()
    window.location.hash = '#/Post/p1'
    render(<App />)

    await screen.findByText('A body')
    expect(screen.getByText('A note')).toBeTruthy()
  })

  /*
   * The promise the server makes and this has to keep: a section never hides a
   * field. Anything left out is in a final group.
   */
  it('shows a field no section claimed', async () => {
    server({
      models: [
        post({
          detail: {
            layout: 'sections',
            sections: [
              { heading: 'General', fields: ['title', 'body'] },
              { heading: 'Other', fields: ['id', 'note'] },
            ],
          },
        }),
      ],
    })
    window.location.hash = '#/Post/p1'
    render(<App />)

    await screen.findByText('A body')
    expect(screen.getByText('A note')).toBeTruthy()
    expect(screen.getByText('General')).toBeTruthy()
  })

  it('puts each group behind a tab when it was asked to', async () => {
    server({
      models: [
        post({
          detail: {
            layout: 'tabs',
            sections: [
              { heading: 'General', fields: ['title', 'body'] },
              { heading: 'Notes', fields: ['note'] },
            ],
          },
        }),
      ],
    })
    window.location.hash = '#/Post/p1'
    render(<App />)

    await screen.findByRole('tab', { name: 'General' })
    expect(screen.getByText('A body')).toBeTruthy()
    // One panel at a time: the other tab's field is not on the page.
    expect(screen.queryByText('A note')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    await screen.findByText('A note')
  })
})

describe('the form', () => {
  it('saves from the rail, which is outside the form element', async () => {
    const calls = server()
    window.location.hash = '#/Post/p1/edit'
    render(<App />)

    const save = await screen.findByRole('button', { name: 'Save' })
    // `form=` is what lets a submit button live in the rail rather than being
    // duplicated inside the form for narrow screens.
    expect(save.getAttribute('form')).toBe('nest-admin-record-form')

    fireEvent.click(save)
    await waitFor(() => expect(calls.some((call) => call.startsWith('PATCH'))).toBe(true))
  })

  it('stays on the form when asked to, rather than leaving for the record', async () => {
    server()
    window.location.hash = '#/Post/p1/edit'
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Save and continue editing/ }))

    await waitFor(() => expect(window.location.hash).toBe('#/Post/p1/edit'))
  })

  /*
   * The failure mode of every grouped form ever built: Save does nothing, and
   * the reason is on a tab nobody is looking at.
   */
  it('opens the tab holding the reason it will not save', async () => {
    server({
      models: [
        post({
          detail: {
            layout: 'tabs',
            sections: [
              { heading: 'General', fields: ['title'] },
              { heading: 'Notes', fields: ['body', 'note'] },
            ],
          },
        }),
      ],
      onWrite: () => ({
        status: 400,
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'That will not do.',
            details: { constraint: 'required', fields: ['note'] },
          },
        },
      }),
    })

    window.location.hash = '#/Post/p1/edit'
    render(<App />)

    const general = await screen.findByRole('tab', { name: 'General' })
    expect(general.getAttribute('aria-selected')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Notes/ }).getAttribute('aria-selected')).toBe('true'),
    )
    // And the tab says how many, so a form with two problems does not look
    // fixed after the first one.
    expect(screen.getByRole('tab', { name: /Notes/ }).textContent).toContain('1')
  })
})
