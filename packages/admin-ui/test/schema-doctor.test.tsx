/**
 * The schema report, on screen.
 *
 * Three things the interface owns here, and all three are about whether anybody
 * reads it: it collapses to one line when there is nothing wrong, it puts the
 * fix beside the finding, and it says so in the navigation when something is
 * actually broken.
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

const model = {
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  can: { list: true, read: true, create: true, update: true, delete: true },
  actions: [],
  fields: [
    {
      name: 'id',
      kind: 'string',
      isId: true,
      isRequired: true,
      isUnique: false,
      isList: false,
      isGenerated: true,
      readOnly: true,
    },
  ],
}

const BROKEN = {
  code: 'composite-primary-key',
  severity: 'broken',
  model: 'Review',
  title: 'Review has a composite primary key',
  detail: 'Opening, editing and deleting a Review all fail. The list itself works.',
}

const GUESSED = {
  code: 'display-field-fell-back',
  severity: 'guessed',
  model: 'Event',
  title: 'Event has no readable column, so its id is shown',
  detail: 'Every reference to an Event shows its id instead of something a person recognises.',
  fix: "models: { Event: { displayField: 'code' } }",
}

function server(findings: readonly unknown[] = []) {
  fetchMock.mockImplementation(async (url: string) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')

    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [model], capabilities: { useDevTools: true } } }
      : path === '/dev/doctor'
        ? { success: true, data: findings }
        : path.startsWith('/dashboard')
          ? { success: true, data: { widgets: [] } }
          : path === '/dev'
            ? {
                success: true,
                data: {
                  models: [{ name: 'User', relations: 0, records: 0 }],
                  totalRecords: 0,
                  adapter: 'prisma',
                  database: 'sqlite',
                  environment: { deployed: false, because: [] },
                  faker: false,
                  images: false,
                  history: [],
                },
              }
            : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } }

    return { status: 200, json: async () => body } as unknown as Response
  })
}

async function openTools(): Promise<void> {
  window.location.hash = '#/~dev'
  render(<App />)
  await screen.findByRole('heading', { name: 'Developer tools' })
}

describe('when there is nothing to report', () => {
  it('says so in one line rather than taking a quarter of the screen', async () => {
    // A panel that spends that much space saying "everything is fine" trains
    // people to skip the place where the problems appear.
    server()
    await openTools()

    expect(await screen.findByText('Nothing to report')).toBeTruthy()
  })

  it('leaves the navigation alone', async () => {
    server()
    window.location.hash = '#/'
    render(<App />)

    const link = await screen.findByRole('link', { name: /Developer tools/ })
    expect(link.textContent).toContain('Dev')
  })
})

describe('when something is wrong', () => {
  it('opens itself for anything broken', async () => {
    // Nobody navigates to a diagnosis. It has to be in front of them.
    server([BROKEN])
    await openTools()

    expect(await screen.findByText(BROKEN.title)).toBeTruthy()
    expect(screen.getByText('1 broken')).toBeTruthy()
  })

  it('counts the guesses separately', async () => {
    server([BROKEN, GUESSED])
    await openTools()

    await screen.findByText('1 broken')
    expect(screen.getByText('1 guessed')).toBeTruthy()
  })

  it('puts the fix beside the finding, ready to copy', async () => {
    // The whole reason these problems persist is that the reader does not know
    // the option exists.
    server([GUESSED])
    await openTools()

    // Guesses alone do not open the card - they are not failures, and a report
    // that unfolds itself over every schema is one people fold away for good.
    fireEvent.click(await screen.findByRole('button', { name: /Schema report/ }))

    expect(await screen.findByText(GUESSED.fix)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy the fix' })).toBeTruthy()
  })

  it('says plainly when no option can fix one', async () => {
    server([BROKEN])
    await openTools()

    expect(await screen.findByText(/needs a change to the schema/)).toBeTruthy()
  })

  it('can be folded away', async () => {
    server([BROKEN])
    await openTools()

    const header = await screen.findByRole('button', { name: /Schema report/ })
    expect(header.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(header)
    await waitFor(() => expect(screen.queryByText(BROKEN.title)).toBeNull())
  })
})

describe('the count in the navigation', () => {
  it('appears for what is broken', async () => {
    server([BROKEN])
    window.location.hash = '#/'
    render(<App />)

    const link = await screen.findByRole('link', { name: /Developer tools/ })
    await waitFor(() => expect(link.textContent).toContain('1'))
  })

  it('ignores the guesses', async () => {
    // Most schemas leave the admin guessing something. A badge that never goes
    // out is a warning people stop seeing.
    server([GUESSED, GUESSED])
    window.location.hash = '#/'
    render(<App />)

    const link = await screen.findByRole('link', { name: /Developer tools/ })
    await waitFor(() => expect(link.textContent).toContain('Dev'))
    expect(link.textContent).not.toContain('2')
  })
})
