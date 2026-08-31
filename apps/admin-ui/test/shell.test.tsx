/**
 * The shell: navigation, appearance, and the command palette.
 *
 * All three are new in 0.8.0 and all three are the kind of thing that works
 * when you try it once and quietly stops working later - a preference that is
 * not read back, a keyboard shortcut nobody rebinds, a class applied to the
 * wrong element. They are asserted rather than demonstrated.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'

const fetchMock = vi.fn()

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
  document.documentElement.className = ''
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

const MODELS = [{ name: 'User', label: 'People' }, { name: 'Post' }, { name: 'Tag' }].map(
  ({ name, label }) => ({
    name,
    ...(label ? { label } : {}),
    primaryKey: ['id'],
    displayField: 'name',
    can: ALL,
    fields: [field('id', { isId: true, isGenerated: true, readOnly: true }), field('name')],
  }),
)

function serve(models: readonly unknown[] = MODELS) {
  fetchMock.mockImplementation(async (url: string) => ({
    status: 200,
    json: async () =>
      String(url).includes('/meta')
        ? { success: true, data: { models } }
        : {
            success: true,
            data: [{ id: 'u1', name: 'Ada' }],
            meta: { total: 1, page: 1, perPage: 25 },
          },
  })) as unknown as Response
}

async function open(): Promise<void> {
  window.location.hash = '#/User'
  render(<App />)
  await screen.findByRole('table')
}

describe('appearance', () => {
  it('offers all three choices rather than a switch', async () => {
    // "System" is a real answer and the default one. A two-state toggle forces
    // everyone who has expressed no preference into having expressed one.
    serve()
    await open()

    const group = screen.getByRole('radiogroup', { name: 'Appearance' })
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
  })

  it('applies the choice to the document, not to a wrapper', async () => {
    // The stylesheet keys off `.dark` on the root element. Applying it lower
    // would leave the page background - painted on `body` - in the old palette.
    serve()
    await open()

    fireEvent.click(screen.getByLabelText('Dark'))
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
    expect(document.documentElement.style.colorScheme).toBe('dark')

    fireEvent.click(screen.getByLabelText('Light'))
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
  })

  it('remembers the choice', async () => {
    serve()
    await open()

    fireEvent.click(screen.getByLabelText('Dark'))
    await waitFor(() => expect(window.localStorage.getItem('nest-admin.appearance')).toBe('dark'))
  })

  it('says which one is in force', async () => {
    // The highlight is not information a screen reader can reach.
    serve()
    await open()

    fireEvent.click(screen.getByLabelText('Dark'))
    await waitFor(() =>
      expect(screen.getByLabelText('Dark').getAttribute('aria-checked')).toBe('true'),
    )
    expect(screen.getByLabelText('System').getAttribute('aria-checked')).toBe('false')
  })

  it('survives storage that refuses to be read', async () => {
    // It throws outright in some privacy modes, and a theme preference is not
    // worth a blank page.
    const boom = () => {
      throw new Error('denied')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom)

    serve()
    await open()
    fireEvent.click(screen.getByLabelText('Dark'))

    // Applied to this page even though it could not be written down.
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })
})

describe('the resource list', () => {
  it('calls each resource what the application calls it', async () => {
    // The sidebar said `User` while every other screen said "People".
    serve()
    await open()

    const nav = screen.getAllByRole('navigation', { name: 'Resources' })[0]!
    expect(within(nav).getByRole('link', { name: 'People' })).toBeTruthy()
    expect(within(nav).queryByRole('link', { name: 'User' })).toBeNull()
  })

  it('marks the one you are looking at', async () => {
    serve()
    await open()

    const nav = screen.getAllByRole('navigation', { name: 'Resources' })[0]!
    expect(within(nav).getByRole('link', { name: 'People' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('collapses, and remembers that too', async () => {
    // For width: a table with a dozen columns wants the whole screen, and the
    // resource list is not what someone reading it is looking at.
    serve()
    await open()

    fireEvent.click(screen.getByLabelText('Hide navigation'))
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Resources' })).toBeNull())
    expect(window.localStorage.getItem('nest-admin.sidebar')).toBe('collapsed')

    fireEvent.click(screen.getByLabelText('Show navigation'))
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Resources' })).toBeTruthy())
  })
})

describe('the command palette', () => {
  it('opens on Ctrl+K and closes again', async () => {
    // Bound on the window, because the point of it is that it works wherever
    // you are - including with focus in a table cell.
    serve()
    await open()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(await screen.findByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('opens on Cmd+K, for the machines that use it', async () => {
    serve()
    await open()

    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('lists every resource, by the name the application gave it', async () => {
    serve()
    await open()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    const box = await screen.findByRole('dialog')
    expect(within(box).getAllByText('People').length).toBeGreaterThan(0)
    expect(within(box).getByText('New Post')).toBeTruthy()
  })

  it('navigates, and closes behind itself', async () => {
    serve()
    await open()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    const box = await screen.findByRole('dialog')
    fireEvent.click(within(box).getByText('Post'))

    await waitFor(() => expect(window.location.hash).toBe('#/Post'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('offers to create only what the policy allows', async () => {
    // Same rule as every other control: the request is checked again when it
    // arrives, and the interface does not promise what it cannot deliver.
    serve(MODELS.map((m) => (m.name === 'Tag' ? { ...m, can: { ...ALL, create: false } } : m)))
    await open()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    const box = await screen.findByRole('dialog')
    expect(within(box).getByText('New Post')).toBeTruthy()
    expect(within(box).queryByText('New Tag')).toBeNull()
  })
})
