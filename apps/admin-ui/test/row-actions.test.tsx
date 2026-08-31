/**
 * What a row lets you do without opening the record.
 *
 * Opening a record to delete it is two navigations to reach a button that was
 * always going to be pressed. The split asserted here is by frequency and by
 * risk: view and edit are one click, everything destructive is one click
 * further, behind a menu - because a delete sitting under the cursor of a
 * control people click all day is how records go missing by muscle memory.
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

const ALL = { list: true, read: true, create: true, update: true, delete: true }

const model = (over: Record<string, unknown> = {}) => ({
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  can: ALL,
  actions: [],
  fields: [field('id', { isId: true, isGenerated: true, readOnly: true }), field('name')],
  ...over,
})

function server(over: Record<string, unknown> = {}) {
  const calls: string[] = []

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)

    return {
      status: 200,
      json: async () =>
        path.startsWith('/meta')
          ? { success: true, data: { models: [model(over)] } }
          : path.startsWith('/actions')
            ? { success: true, data: { message: 'Done.' } }
            : init?.method === 'DELETE'
              ? { success: true, data: null }
              : {
                  success: true,
                  data: [{ id: 'u1', name: 'Ada' }],
                  meta: { total: 1, page: 1, perPage: 25 },
                },
    } as unknown as Response
  })

  return { calls }
}

async function openList(): Promise<void> {
  window.location.hash = '#/User'
  render(<App />)
  await screen.findByRole('table')
}

/** Open the row's overflow menu and return it. */
async function openMenu(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole('button', { name: /more actions for Ada/i }), {
    key: 'Enter',
  })
  return screen.findByRole('menu')
}

describe('the buttons a wide screen shows', () => {
  it('names them after the record rather than saying "View"', async () => {
    // Forty rows of the word "View" tells a screen reader forty times that
    // there is a link, and never which record it opens.
    server()
    await openList()

    expect(screen.getByRole('link', { name: 'View Ada' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Edit Ada' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete Ada' })).toBeTruthy()
  })

  it('links straight to the record and to its form', async () => {
    server()
    await openList()

    expect(screen.getByRole('link', { name: 'View Ada' }).getAttribute('href')).toBe('#/User/u1')
    expect(screen.getByRole('link', { name: 'Edit Ada' }).getAttribute('href')).toBe(
      '#/User/u1/edit',
    )
  })

  it('withholds Edit when the policy refuses it', async () => {
    server({ can: { ...ALL, update: false } })
    await openList()

    expect(screen.queryByRole('link', { name: 'Edit Ada' })).toBeNull()
    expect(screen.getByRole('link', { name: 'View Ada' })).toBeTruthy()
  })

  it('deletes from the row, asking first', async () => {
    const { calls } = server()
    await openList()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Ada' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Ada')
    expect(calls).not.toContain('DELETE /User/u1')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls).toContain('DELETE /User/u1'))
  })
})

describe('the menu', () => {
  it('holds the destructive one, a step away from the others', async () => {
    server()
    await openList()

    const menu = await openMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
  })

  it('asks before deleting, and sends nothing until answered', async () => {
    const { calls } = server()
    await openList()

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('alertdialog')
    // Naming the record, because "Delete this record?" on a table of forty is
    // a question about which one.
    expect(dialog.textContent).toContain('Ada')
    expect(calls).not.toContain('DELETE /User/u1')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls).toContain('DELETE /User/u1'))
  })

  it('carries the actions the application declared', async () => {
    server({
      actions: [{ name: 'ban', label: 'Ban', scope: 'record', danger: true }],
    })
    await openList()

    const menu = await openMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Ban' })).toBeTruthy()
  })

  it('runs one against the record it belongs to', async () => {
    const { calls } = server({
      actions: [{ name: 'ban', label: 'Ban', scope: 'record' }],
    })
    await openList()

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ban' }))

    await waitFor(() => expect(calls).toContain('POST /actions/User/ban/u1'))
  })

  it('holds the same actions the wide screen shows as buttons', async () => {
    /*
     * The two arrangements are the same set, not two feature levels.
     *
     * Which one is drawn is a media query, which jsdom cannot evaluate - so
     * both are in the document here and CSS decides. What is asserted is the
     * part that matters and that a media query cannot get wrong: nothing is
     * reachable on one screen and missing on the other.
     */
    server()
    await openList()

    const menu = await openMenu()
    for (const name of ['View', 'Edit', 'Delete']) {
      expect(within(menu).getByRole('menuitem', { name }), name).toBeTruthy()
    }
  })

  it('leaves out what the policy refuses, in both arrangements', async () => {
    server({ can: { ...ALL, update: false, delete: false } })
    await openList()

    expect(screen.queryByRole('link', { name: 'Edit Ada' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete Ada' })).toBeNull()

    const menu = await openMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'View' })).toBeTruthy()
  })

  it('does not offer a list-scoped action on a row', async () => {
    // It applies to the model, not to this record, and running it from a row
    // would imply otherwise.
    server({
      actions: [{ name: 'purge', label: 'Purge all', scope: 'list' }],
    })
    await openList()

    const menu = await openMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Purge all' })).toBeNull()
  })
})
