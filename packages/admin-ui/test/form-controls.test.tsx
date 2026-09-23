/**
 * The form, 0.20.0.
 *
 * Three things, and only one of them is a control. The one that matters is the
 * guard: a form somebody has half filled in must not disappear because they
 * clicked the sidebar, and that is the single most painful thing a generated
 * admin does.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { isSessionProbe, NO_LOGIN_ROUTES } from './no-login.js'

const fetchMock = vi.fn()

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

const MODEL = {
  name: 'Post',
  primaryKey: ['id'],
  displayField: 'title',
  can: { list: true, read: true, create: true, update: true, delete: true },
  actions: [],
  fields: [
    field('id', { isId: true, isGenerated: true, readOnly: true }),
    field('title', { help: 'Shown on the article page.' }),
    field('status', { kind: 'enum', enumValues: ['DRAFT', 'PUBLISHED'], widget: 'radio' }),
    field('featured', { kind: 'boolean', widget: 'switch' }),
    field('plain', { kind: 'boolean' }),
  ],
}

function server() {
  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')

    // The dashboard needs its own shape: some of these tests navigate to it,
    // and a list envelope there throws while rendering rather than showing an
    // empty page - which then looks like the form failing to appear.
    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [MODEL], capabilities: {} } }
      : path.startsWith('/dashboard')
        ? { success: true, data: { widgets: [], generated: false } }
        : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } }

    return { status: 200, ok: true, json: async () => body } as unknown as Response
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  server()
})

afterEach(() => vi.unstubAllGlobals())

describe('the controls a field can ask for', () => {
  it('draws a radio group for an enum that asked for one', async () => {
    window.location.hash = '#/Post/new'
    render(<App />)
    await screen.findByRole('group', { name: /status/ })

    expect(screen.getByRole('radio', { name: 'DRAFT' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'PUBLISHED' })).toBeTruthy()
  })

  /*
   * `role="switch"` rather than `checkbox`, which is the only thing the role
   * changes: a screen reader says "on" and "off" instead of "checked". The
   * element underneath is a real checkbox, so everything else already worked.
   */
  it('draws a switch for a boolean that asked for one, and a checkbox otherwise', async () => {
    window.location.hash = '#/Post/new'
    render(<App />)
    await screen.findByRole('switch', { name: /featured/ })

    expect(screen.getByRole('checkbox', { name: /plain/ })).toBeTruthy()
  })

  it('picking a radio changes the value', async () => {
    window.location.hash = '#/Post/new'
    render(<App />)
    const published = await screen.findByRole('radio', { name: 'PUBLISHED' })

    fireEvent.click(published)
    expect((published as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'DRAFT' }) as HTMLInputElement).checked).toBe(false)
  })
})

describe('help text', () => {
  it('describes the field rather than naming it', async () => {
    window.location.hash = '#/Post/new'
    render(<App />)
    const box = await screen.findByLabelText(/^title/)

    expect(screen.getByText('Shown on the article page.')).toBeTruthy()
    // Described, not named: folding it into the label would have it announced
    // on every visit to the box thereafter.
    expect(box.getAttribute('aria-describedby')).toBe('field-title-help')
    expect(box.getAttribute('aria-labelledby')).toBeNull()
  })
})

describe('the first box on a create form', () => {
  it('has focus, because nobody opens "New Post" to read it', async () => {
    window.location.hash = '#/Post/new'
    render(<App />)
    const box = await screen.findByLabelText(/^title/)

    await waitFor(() => expect(document.activeElement).toBe(box))
  })
})

describe('leaving with unsaved changes', () => {
  /*
   * The whole point. Typed, then a click on the sidebar - and without this the
   * form is gone with no warning and no way back.
   */
  it('asks before following a link inside the admin', async () => {
    window.location.hash = '#/Post/new'
    render(<App />)
    const box = await screen.findByLabelText(/^title/)

    fireEvent.change(box, { target: { value: 'Half written' } })

    const nav = within(screen.getByRole('navigation', { name: 'Resources' }))
    fireEvent.click(nav.getByRole('link', { name: 'Dashboard' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/have not been saved/)).toBeTruthy()

    // Staying leaves the form exactly as it was, values and all.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((screen.getByLabelText(/^title/) as HTMLInputElement).value).toBe('Half written')
  })

  /*
   * A form nobody changed has nothing to lose, and a question asked every time
   * is a question people learn to dismiss without reading.
   */
  it('says nothing when nothing was changed', async () => {
    window.location.hash = '#/Post/new'
    render(<App />)
    await screen.findByLabelText(/^title/)

    const nav = within(screen.getByRole('navigation', { name: 'Resources' }))
    fireEvent.click(nav.getByRole('link', { name: 'Dashboard' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()

    // Awaited, and not only for the assertion's sake: jsdom defers a fragment
    // navigation to a later task, so leaving it in flight lets it land during
    // the *next* test and quietly move that one off the page it just opened.
    await waitFor(() => expect(window.location.hash).toBe('#/'))
  })

  /*
   * Typed and undone is unchanged. Comparing values rather than latching a
   * flag is what makes that true - and a guard that fired here would be one
   * more question nobody reads.
   */
  it('says nothing when a change was undone', async () => {
    window.location.hash = '#/Post/new'
    render(<App />)
    const box = await screen.findByLabelText(/^title/)

    fireEvent.change(box, { target: { value: 'Typed' } })
    fireEvent.change(box, { target: { value: '' } })

    const nav = within(screen.getByRole('navigation', { name: 'Resources' }))
    fireEvent.click(nav.getByRole('link', { name: 'Dashboard' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()

    // Same reason as above: the navigation is deferred, and an unawaited one
    // lands in the next test.
    await waitFor(() => expect(window.location.hash).toBe('#/'))
  })

  it('lets go when the answer is to leave', async () => {
    window.location.hash = '#/Post/new'
    render(<App />)
    const box = await screen.findByLabelText(/^title/)

    fireEvent.change(box, { target: { value: 'Half written' } })

    const nav = within(screen.getByRole('navigation', { name: 'Resources' }))
    fireEvent.click(nav.getByRole('link', { name: 'Dashboard' }))

    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave' }))

    await waitFor(() => expect(window.location.hash).toBe('#/'))
  })
})
