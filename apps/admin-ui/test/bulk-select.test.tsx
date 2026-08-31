/**
 * Selecting rows, and acting on the selection.
 *
 * Three things are worth asserting and one of them is easy to get wrong. The
 * easy one: a partially selected page must not look like an empty one, or the
 * next click on the header checkbox does the opposite of what it appears to.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'

const fetchMock = vi.fn()

beforeEach(() => {
  window.location.hash = ''
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

/**
 * The confirmation, as a person answers it.
 *
 * It used to be `window.confirm`, which a test could stub with a boolean. It
 * is a real dialog now - focus-trapped, escapable, announced as an alert - so
 * answering it means finding it and pressing something. What is being asserted
 * either way is the same: nothing is sent until the question is answered.
 */
const dialog = () => screen.getByRole('alertdialog')
const answer = async (label: RegExp): Promise<void> => {
  const box = await screen.findByRole('alertdialog')
  fireEvent.click(within(box).getByRole('button', { name: label }))
}

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

const model = (can: Record<string, boolean> = ALL) => ({
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  can,
  fields: [field('id', { isId: true, isGenerated: true, readOnly: true }), field('name')],
})

const ROWS = [
  { id: 'u1', name: 'Ada' },
  { id: 'u2', name: 'Bob' },
  { id: 'u3', name: 'Cy' },
]

/** A server whose bulk delete answers with whatever the test hands it. */
function server(options: { can?: Record<string, boolean>; result?: unknown } = {}) {
  const sent: unknown[] = []

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace('/admin', '')

    if (init?.method === 'DELETE') {
      sent.push(JSON.parse(String(init.body)))
      return {
        status: 200,
        json: async () => ({
          success: true,
          data: options.result ?? { deleted: ['u1', 'u3'], failed: [] },
        }),
      } as unknown as Response
    }

    return {
      status: 200,
      json: async () =>
        path.startsWith('/meta')
          ? { success: true, data: { models: [model(options.can ?? ALL)] } }
          : { success: true, data: ROWS, meta: { total: 3, page: 1, perPage: 25 } },
    } as unknown as Response
  })

  return { sent }
}

async function openList(): Promise<void> {
  window.location.hash = '#/User'
  render(<App />)
  await screen.findByText('Ada')
}

const rowBox = (name: string) => screen.getByLabelText(`Select ${name}`)

describe('choosing rows', () => {
  it('shows nothing until something is chosen', async () => {
    server()
    await openList()

    expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull()

    fireEvent.click(rowBox('Ada'))
    expect(screen.getByRole('button', { name: 'Delete selected' })).toBeTruthy()
  })

  it('counts what is chosen', async () => {
    server()
    await openList()

    fireEvent.click(rowBox('Ada'))
    fireEvent.click(rowBox('Cy'))
    expect(screen.getByText('2 selected')).toBeTruthy()

    fireEvent.click(rowBox('Cy'))
    expect(screen.getByText('1 selected')).toBeTruthy()
  })

  it('names each checkbox after its record', async () => {
    // "checkbox" repeated forty times tells a screen reader nothing.
    server()
    await openList()

    expect(rowBox('Ada')).toBeTruthy()
    expect(rowBox('Bob')).toBeTruthy()
  })
})

describe('the header checkbox', () => {
  const header = () => screen.getByLabelText(/^Select all|^Deselect all/)

  it('takes the whole page, and gives it back', async () => {
    server()
    await openList()

    fireEvent.click(header())
    expect(screen.getByText('3 selected')).toBeTruthy()

    fireEvent.click(header())
    expect(screen.queryByText(/selected$/)).toBeNull()
  })

  it('reads as partial when only some rows are chosen', async () => {
    // No HTML attribute does this - `indeterminate` is a property. Without it
    // a partial selection is indistinguishable from an empty one.
    server()
    await openList()

    fireEvent.click(rowBox('Ada'))

    const box = header() as HTMLInputElement
    await waitFor(() => expect(box.indeterminate).toBe(true))
    expect(box.checked).toBe(false)
  })

  it('is neither partial nor empty when every row is chosen', async () => {
    server()
    await openList()

    fireEvent.click(header())

    const box = header() as HTMLInputElement
    await waitFor(() => expect(box.checked).toBe(true))
    expect(box.indeterminate).toBe(false)
  })
})

describe('deleting the selection', () => {
  it('asks first, and sends the chosen ids', async () => {
    const { sent } = server()
    await openList()

    fireEvent.click(rowBox('Ada'))
    fireEvent.click(rowBox('Cy'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))

    // Asked, and naming how many - so the answer is about a known quantity.
    expect((await screen.findByRole('alertdialog')).textContent).toMatch(/2 records/)
    // And nothing has gone anywhere yet.
    expect(sent).toEqual([])

    await answer(/^Delete$/)
    await waitFor(() => expect(sent).toEqual([{ ids: ['u1', 'u3'] }]))
  })

  it('is announced as an alert, not merely shown', async () => {
    // `role="alertdialog"` rather than `dialog`: it traps focus, cannot be
    // dismissed by clicking away, and is announced immediately. A destructive
    // confirmation someone can dismiss by missing is not one.
    server()
    await openList()

    fireEvent.click(rowBox('Ada'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))

    expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })

  it('sends nothing when the confirmation is declined', async () => {
    const { sent } = server()
    await openList()

    fireEvent.click(rowBox('Ada'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    await answer(/^Cancel$/)

    expect(sent).toEqual([])
    // And the selection survives, so the click can be repeated deliberately.
    expect(screen.getByText('1 selected')).toBeTruthy()
  })

  it('gives focus back to the button that opened it', async () => {
    // Radix returns focus to its own Trigger, and this dialog has none - it is
    // opened by a promise from wherever the call site is. Without handling it,
    // cancelling drops a keyboard user at the top of the document, dozens of
    // tab stops from where they were. Found by walking the interface with no
    // mouse rather than by reading the code.
    server()
    await openList()

    fireEvent.click(rowBox('Ada'))
    const trigger = screen.getByRole('button', { name: 'Delete selected' })
    trigger.focus()
    fireEvent.click(trigger)
    await answer(/^Cancel$/)

    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('treats dismissing the dialog as declining it', async () => {
    // Escape closes it without an answer. Anything that is not "yes" is "no".
    const { sent } = server()
    await openList()

    fireEvent.click(rowBox('Ada'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    fireEvent.keyDown(dialog(), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(sent).toEqual([])
  })

  it('reports both halves of a partial result', async () => {
    // Nothing is rolled back, so "2 deleted" alone and "it failed" alone both
    // leave someone with a wrong idea of what the database now contains.
    server({ result: { deleted: ['u1'], failed: [{ id: 'u3', message: 'Still referenced.' }] } })
    await openList()

    fireEvent.click(screen.getByLabelText(/^Select all/))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    await answer(/^Delete$/)

    const outcome = await screen.findByText(/1 deleted, 1 could not be/)
    // Announced, not just printed: the person pressed a button and looked away.
    expect(outcome.closest('[role="status"]')).toBeTruthy()
    expect(screen.getByText(/Still referenced/)).toBeTruthy()
  })

  it('clears the selection afterwards', async () => {
    server()
    await openList()

    fireEvent.click(rowBox('Ada'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    await answer(/^Delete$/)

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull(),
    )
  })
})

describe('when the policy says no', () => {
  it('offers no checkboxes at all', async () => {
    // The request is checked again when it arrives; this stops the interface
    // promising something it cannot deliver.
    server({ can: { ...ALL, delete: false } })
    await openList()

    expect(screen.queryByLabelText('Select Ada')).toBeNull()
    expect(screen.queryByLabelText(/^Select all/)).toBeNull()
  })
})
