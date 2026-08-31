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
  /*
   * One button, not three.
   *
   * 0.8.0 shipped a three-way control - light, dark, follow the system - and
   * these tests asserted it. The control changed deliberately, so the tests
   * change with it: switching is something people do often and idly, and
   * picking from a list of three to do it is three times the interaction for
   * the same outcome.
   *
   * The argument for "system" was about the *default*, and that behaviour is
   * unchanged and still asserted below: nothing is stored until the button is
   * pressed, and until then the admin follows the operating system.
   */
  it('is a single button that switches to the other mode', async () => {
    serve()
    await open()

    fireEvent.click(screen.getByRole('button', { name: /switch to dark mode/i }))
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))

    // And the button now offers the way back, rather than repeating itself.
    fireEvent.click(screen.getByRole('button', { name: /switch to light mode/i }))
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
  })

  it('applies the choice to the document, not to a wrapper', async () => {
    // The stylesheet keys off `.dark` on the root element. Applying it lower
    // would leave the page background - painted on `body` - in the old palette.
    serve()
    await open()

    fireEvent.click(screen.getByRole('button', { name: /switch to dark mode/i }))
    await waitFor(() => expect(document.documentElement.style.colorScheme).toBe('dark'))
  })

  it('remembers the choice', async () => {
    serve()
    await open()

    fireEvent.click(screen.getByRole('button', { name: /switch to dark mode/i }))
    await waitFor(() => expect(window.localStorage.getItem('nest-admin.appearance')).toBe('dark'))
  })

  it('follows the system until someone says otherwise', async () => {
    // The half of the three-way control worth keeping. Nothing is written down
    // on load, so a machine that switches at dusk still switches the admin.
    serve()
    await open()

    expect(window.localStorage.getItem('nest-admin.appearance')).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: /switch to dark mode/i }))

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

  it('collapses to a rail rather than disappearing', async () => {
    /*
     * A deliberate change from 0.8.0, where collapsing removed the navigation
     * from the page. That took every link out of reach and out of the tab
     * order, which made the collapse an all-or-nothing choice nobody makes
     * twice - and left nothing to animate between.
     *
     * The links stay. What changes is the width, so every one of them is still
     * one click away.
     */
    serve()
    await open()

    const links = () => within(screen.getAllByRole('navigation', { name: 'Resources' })[0]!)
    expect(links().getAllByRole('link')).toHaveLength(3)

    fireEvent.click(screen.getByLabelText('Collapse navigation'))
    await waitFor(() => expect(screen.getByLabelText('Expand navigation')).toBeTruthy())

    // Still there, still reachable, still named - the label is what a screen
    // reader gets whether or not it is drawn.
    expect(links().getAllByRole('link')).toHaveLength(3)
    expect(links().getByRole('link', { name: 'People' })).toBeTruthy()
    expect(window.localStorage.getItem('nest-admin.sidebar')).toBe('collapsed')
  })

  it('shows an icon where the application chose one', async () => {
    // And nothing where it did not: the same icon on every entry is decoration.
    // The initial stands in on the rail, where something has to tell one row
    // from the next.
    serve(MODELS.map((m) => (m.name === 'User' ? { ...m, icon: 'users' } : m)))
    await open()

    const nav = screen.getAllByRole('navigation', { name: 'Resources' })[0]!
    expect(nav.querySelector('svg')).toBeTruthy()
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
