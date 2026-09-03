/**
 * A file column, where it is read rather than edited.
 *
 * The bug this file records: a `widget: 'image'` column drew a picture in the
 * form and printed `2026/09/abc123-ada.png` everywhere else. True, unreadable,
 * and the reason an avatar column exists is to be recognised at a glance.
 *
 * The rest is about the two states that are not a picture. A column that is
 * empty and a column whose file is gone are different facts about a record, and
 * neither of them should be the browser's broken-image glyph - which is
 * unstyled, differs per browser, and reports a missing file as a fault in the
 * page.
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

const model = (avatar: Record<string, unknown>) => ({
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  can: ALL,
  fields: [
    field('id', { isId: true, isGenerated: true, readOnly: true }),
    field('name'),
    field('avatarUrl', avatar),
  ],
})

function server(avatar: Record<string, unknown>, value: unknown): void {
  const record = { id: 'u1', name: 'Ada', avatarUrl: value }

  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [model(avatar)] } }
      : path.startsWith('/User/u1')
        ? { success: true, data: record }
        : { success: true, data: [record], meta: { total: 1, page: 1, perPage: 25 } }
    return { status: 200, json: async () => body } as unknown as Response
  })
}

/** The one thumbnail on the screen, once the row has arrived. */
async function thumbnail(): Promise<HTMLImageElement> {
  await screen.findByText('Ada')
  const image = document.querySelector('img')
  if (image === null) throw new Error('no image rendered')
  return image as HTMLImageElement
}

describe('an image column in the table', () => {
  it('draws the picture instead of printing the key', async () => {
    server({ widget: 'image' }, '2026/09/abc123-ada.png')
    window.location.hash = '#/User'
    render(<App />)

    const image = await thumbnail()
    expect(image.getAttribute('src')).toBe('/admin/files/2026/09/abc123-ada.png')
    // The key itself is what used to be in the cell.
    expect(screen.queryByText('2026/09/abc123-ada.png')).toBeNull()
  })

  it('leaves a value that is already a location alone', async () => {
    // A column that held a CDN address long before this admin existed, and any
    // store that answers with its own URLs.
    server({ widget: 'image' }, 'https://cdn.example.com/ada.png')
    window.location.hash = '#/User'
    render(<App />)

    expect((await thumbnail()).getAttribute('src')).toBe('https://cdn.example.com/ada.png')
  })

  it('loads below-the-fold rows lazily', async () => {
    server({ widget: 'image' }, '2026/09/abc123-ada.png')
    window.location.hash = '#/User'
    render(<App />)

    expect((await thumbnail()).getAttribute('loading')).toBe('lazy')
  })
})

describe('when there is no picture to draw', () => {
  it('draws nothing rather than a broken glyph', async () => {
    server({ widget: 'image' }, null)
    window.location.hash = '#/User'
    render(<App />)

    await screen.findByText('Ada')
    expect(document.querySelector('img')).toBeNull()
  })

  it('falls back to the application default when the column is empty', async () => {
    server({ widget: 'image', placeholder: '/img/avatar.png' }, '')
    window.location.hash = '#/User'
    render(<App />)

    expect((await thumbnail()).getAttribute('src')).toBe('/img/avatar.png')
  })

  it('falls back to it when the stored file will not load', async () => {
    // The state this was written for: the column still points at a key whose
    // file was deleted, or at a URL that has since 404ed.
    server({ widget: 'image', placeholder: '/img/avatar.png' }, '2026/09/abc123-gone.png')
    window.location.hash = '#/User'
    render(<App />)

    fireEvent.error(await thumbnail())

    await waitFor(() =>
      expect(document.querySelector('img')?.getAttribute('src')).toBe('/img/avatar.png'),
    )
  })

  it('survives a default that is itself wrong', async () => {
    // A typo in the placeholder path would otherwise turn every row into a
    // broken glyph - worse than the state it was added to improve.
    server({ widget: 'image', placeholder: '/img/typo.png' }, '2026/09/abc123-gone.png')
    window.location.hash = '#/User'
    render(<App />)

    fireEvent.error(await thumbnail())
    await waitFor(() =>
      expect(document.querySelector('img')?.getAttribute('src')).toBe('/img/typo.png'),
    )
    fireEvent.error(document.querySelector('img') as HTMLImageElement)

    await waitFor(() => expect(document.querySelector('img')).toBeNull())
    // And says which of the two blank states this is.
    expect(screen.getByTitle('This image could not be loaded.')).toBeTruthy()
  })

  it('does not call an empty column broken', async () => {
    server({ widget: 'image' }, '')
    window.location.hash = '#/User'
    render(<App />)

    await screen.findByText('Ada')
    expect(screen.queryByTitle('This image could not be loaded.')).toBeNull()
  })
})

describe('a file column that is not a picture', () => {
  it('shows what it is called and links to it', async () => {
    server({ widget: 'file' }, '2026/09/abc123-contract.pdf')
    window.location.hash = '#/User'
    render(<App />)

    const link = await screen.findByRole('link', { name: 'contract.pdf' })
    expect(link.getAttribute('href')).toBe('/admin/files/2026/09/abc123-contract.pdf')
  })

  it('still draws a picture when one is stored on it', async () => {
    // A file field that happens to hold a screenshot should show the
    // screenshot; only the extension can say so.
    server({ widget: 'file' }, '2026/09/abc123-screenshot.png')
    window.location.hash = '#/User'
    render(<App />)

    expect((await thumbnail()).getAttribute('src')).toBe(
      '/admin/files/2026/09/abc123-screenshot.png',
    )
  })
})

describe('on the detail page', () => {
  it('shows the picture, named, and links to the file', async () => {
    server({ widget: 'image' }, '2026/09/abc123-ada.png')
    window.location.hash = '#/User/u1'
    render(<App />)

    await screen.findByRole('heading', { name: 'Ada' })
    const image = document.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/admin/files/2026/09/abc123-ada.png')
    // Named here, where it is the subject, and not in a table where the
    // filename would be read out once per row.
    expect(image?.getAttribute('alt')).toBe('ada.png')

    const link = screen.getByRole('link', { name: 'ada.png' })
    expect(link.getAttribute('href')).toBe('/admin/files/2026/09/abc123-ada.png')
  })
})
