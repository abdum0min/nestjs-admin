/**
 * Formatted text on a string column.
 *
 * Three places show the same value and each one has a different job: the form
 * edits it, the record page renders it, the table reduces it to a line. The
 * dangerous one is the middle: HTML out of a database rendered on the admin's
 * own origin is a session-stealing XSS wherever anything less trusted than an
 * administrator can write that column.
 *
 * So the read-only view goes through the editor's own parser rather than
 * `innerHTML`, and the assertion that matters here is not that a heading
 * renders - it is that a `<script>` does not.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { formatCell } from '../src/metadata/format.js'
import { textFromHtml } from '../src/metadata/html.js'
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

const model = {
  name: 'Post',
  primaryKey: ['id'],
  displayField: 'title',
  can: { list: true, read: true, create: true, update: true, delete: true },
  actions: [],
  fields: [
    field('id', { isId: true, isGenerated: true, readOnly: true }),
    field('title'),
    field('body', { widget: 'richtext' }),
  ],
}

const BODY = '<h2>Copper harbour</h2><p>Two sentences about it.</p><ul><li>One</li></ul>'
const HOSTILE = '<p>Ordinary text.</p><script>window.__stolen = true</script>'

function server(body: string = BODY) {
  const record = { id: 'p1', title: 'A post', body }

  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')

    const payload = path.startsWith('/meta')
      ? { success: true, data: { models: [model], capabilities: {} } }
      : path.startsWith('/Post/p1')
        ? { success: true, data: record }
        : { success: true, data: [record], meta: { total: 1, page: 1, perPage: 25 } }

    return { status: 200, json: async () => payload } as unknown as Response
  })
}

describe('a cell', () => {
  it('shows the words, never the markup', () => {
    expect(formatCell(field('body', { widget: 'richtext' }) as never, BODY)).toBe(
      'Copper harbour Two sentences about it. One',
    )
  })

  it('leaves an ordinary column alone', () => {
    expect(formatCell(field('body') as never, '<b>kept</b>')).toBe('<b>kept</b>')
  })

  it('reads the entities a browser writes', () => {
    expect(textFromHtml('<p>Tom &amp; Jerry &lt;3</p>')).toBe('Tom & Jerry <3')
  })

  it('is empty for an empty document', () => {
    expect(textFromHtml('<p></p>')).toBe('')
  })
})

describe('the record page', () => {
  it('renders the document', async () => {
    server()
    window.location.hash = '#/Post/p1'
    render(<App />)

    await screen.findByRole('heading', { name: 'A post' })
    await waitFor(() => expect(screen.getByText('Copper harbour')).toBeTruthy())
    expect(screen.getByText('Two sentences about it.')).toBeTruthy()
  })

  it('does not let a script out of the database onto the page', async () => {
    // The whole reason the read-only view goes through the parser. TipTap's
    // document model has no script node, so the tag never becomes an element.
    server(HOSTILE)
    window.location.hash = '#/Post/p1'
    render(<App />)

    await waitFor(() => expect(screen.getByText('Ordinary text.')).toBeTruthy())
    expect(document.querySelector('script')).toBeNull()
    expect((window as unknown as { __stolen?: boolean }).__stolen).toBeUndefined()
  })

  it('says so when the column is empty rather than rendering a blank', async () => {
    server('')
    window.location.hash = '#/Post/p1'
    render(<App />)

    await screen.findByRole('heading', { name: 'A post' })
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('the form', () => {
  it('offers an editor rather than a text box', async () => {
    server()
    window.location.hash = '#/Post/p1/edit'
    render(<App />)

    // The chunk arrives, then the toolbar.
    expect(await screen.findByRole('button', { name: 'Bold' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Link' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /Body/i })).toBeTruthy()
  })

  it('opens with what the record holds', async () => {
    server()
    window.location.hash = '#/Post/p1/edit'
    render(<App />)

    await screen.findByRole('button', { name: 'Bold' })
    await waitFor(() => expect(screen.getByText('Copper harbour')).toBeTruthy())
  })
})
