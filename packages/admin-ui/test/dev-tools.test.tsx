/**
 * The developer tools screen.
 *
 * The interface owns almost nothing here - the server decides what may be
 * generated and what may be emptied. What this file asserts is the part that is
 * the interface's alone: the screen is unreachable unless the server says the
 * tools exist, each model carries its own number, the preview writes nothing,
 * failures are shown rather than hidden, and the two buttons that delete things
 * ask first.
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

/** Bodies of the requests the screen sent, so a payload can be asserted. */
const bodies: string[] = []

function server(
  capabilities: Record<string, unknown> = { useDevTools: true },
  status: Record<string, unknown> = {},
) {
  const calls: string[] = []
  bodies.length = 0

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    if (typeof init?.body === 'string') bodies.push(init.body)

    const body = path.startsWith('/meta')
      ? { success: true, data: { models: [model], capabilities } }
      : path === '/dev'
        ? {
            success: true,
            data: {
              models: [
                { name: 'User', relations: 0, records: 3 },
                { name: 'Post', relations: 2, records: 0 },
              ],
              totalRecords: 3,
              adapter: 'prisma',
              environment: { deployed: false, because: [] },
              faker: false,
              images: true,
              history: [],
              ...status,
            },
          }
        : path === '/dev/preview'
          ? {
              success: true,
              data: { model: 'User', records: [{ email: 'ada@example.com', name: 'Ada' }] },
            }
          : path === '/dev/fill'
            ? {
                success: true,
                data: [
                  { model: 'User', created: 20, ids: [], failed: [] },
                  {
                    model: 'Post',
                    created: 2,
                    ids: [],
                    failed: [{ reason: 'Another Post already has this slug.', count: 3 }],
                  },
                ],
              }
            : path === '/dev/truncate'
              ? { success: true, data: { deleted: 12, remaining: 0 } }
              : path === '/dev/reset'
                ? {
                    success: true,
                    data: [
                      { model: 'Post', deleted: 2, remaining: 0 },
                      { model: 'User', deleted: 3, remaining: 0 },
                    ],
                  }
                : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } }

    return { status: 200, json: async () => body } as unknown as Response
  })

  return { calls }
}

async function openTools(): Promise<void> {
  window.location.hash = '#/~dev'
  render(<App />)
  await screen.findByRole('heading', { name: 'Developer tools' })
}

const generateButton = () => screen.getByRole('button', { name: /Generate \d+ records/ })

describe('whether the screen exists at all', () => {
  it('is in the navigation when the server says so', async () => {
    server()
    window.location.hash = '#/'
    render(<App />)

    const link = await screen.findByRole('link', { name: /Developer tools/ })
    expect(link.getAttribute('href')).toBe('#/~dev')
  })

  it('is absent when it does not', async () => {
    // A build without the tools and a role without the capability look
    // identical from here, which is right: neither is part of this admin.
    server({ useDevTools: false })
    window.location.hash = '#/'
    render(<App />)

    await screen.findByRole('link', { name: 'Dashboard' })
    expect(screen.queryByRole('link', { name: /Developer tools/ })).toBeNull()
  })

  it('is absent against a server that has never heard of it', async () => {
    server({})
    window.location.hash = '#/'
    render(<App />)

    await screen.findByRole('link', { name: 'Dashboard' })
    expect(screen.queryByRole('link', { name: /Developer tools/ })).toBeNull()
  })

  it('is marked as not being one of the resources', async () => {
    server()
    window.location.hash = '#/'
    render(<App />)

    const link = await screen.findByRole('link', { name: /Developer tools/ })
    // A tool that can empty a table must not look like a table.
    expect(link.textContent).toContain('Dev')
  })
})

describe('choosing what to generate', () => {
  it('lists every model with its own count', async () => {
    // The shape of the whole screen: not one model at a time, and not one
    // number for all of them. "Twenty users and fifty products, no order
    // lines" is what people actually want.
    server()
    await openTools()

    expect(screen.getByRole('checkbox', { name: 'Generate User' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: 'How many Post' })).toBeTruthy()
  })

  it('says how many relations it will wire up', async () => {
    // Trusting a generator starts with knowing what it will touch.
    server()
    await openTools()

    expect(screen.getByText('Auto (2)')).toBeTruthy()
  })

  it('starts with everything selected, because that is the common press', async () => {
    server()
    await openTools()

    expect(screen.getByText('2 of 2 selected')).toBeTruthy()
  })

  it('sends each model its own number', async () => {
    const { calls } = server()
    await openTools()

    fireEvent.change(screen.getByRole('spinbutton', { name: 'How many User' }), {
      target: { value: '7' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Generate Post' }))
    fireEvent.click(generateButton())

    await waitFor(() => expect(calls).toContain('POST /dev/fill'))
    expect(JSON.parse(bodies.at(-1) ?? '{}').models).toEqual([{ name: 'User', count: 7 }])
  })
})

describe('previewing', () => {
  it('writes nothing', async () => {
    const { calls } = server()
    await openTools()

    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[0] as HTMLElement)

    expect(await screen.findByText('ada@example.com')).toBeTruthy()
    expect(calls).toContain('POST /dev/preview')
    expect(calls).not.toContain('POST /dev/fill')
  })
})

describe('what a run reports', () => {
  it('shows both halves, not only the green one', async () => {
    // A screen that showed only what succeeded would describe a product that
    // does not exist: a schema with two spare users gives two profiles.
    server()
    await openTools()

    fireEvent.click(generateButton())

    expect(await screen.findByText(/22 records/)).toBeTruthy()
    expect(screen.getByText(/Another Post already has this slug/)).toBeTruthy()
  })
})

describe('what the header says', () => {
  it('names the adapter and counts the rows that exist', async () => {
    server()
    await openTools()

    expect(screen.getByText('prisma')).toBeTruthy()
    // The total, in the header card - the same number also appears in the
    // table's own "records now" column, which is why this asks for the card.
    expect(screen.getByText('across every model')).toBeTruthy()
    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
  })

  it('reports what the deployment check saw, not NODE_ENV alone', async () => {
    // A card that named one variable would teach the wrong rule about a gate
    // that reads a dozen.
    server()
    await openTools()

    expect(screen.getByText('Local')).toBeTruthy()
    expect(screen.getByText('No deployment signals')).toBeTruthy()
  })

  it('says so when it is running somewhere that looks deployed', async () => {
    server({ useDevTools: true }, { environment: { deployed: true, because: ['RENDER'] } })
    await openTools()

    expect(screen.getByText('Looks deployed')).toBeTruthy()
    expect(screen.getByText('RENDER')).toBeTruthy()
  })
})

describe('undo', () => {
  it('is offered only when there is something to undo', async () => {
    server()
    await openTools()
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()

    await screen.findByRole('heading', { name: 'Developer tools' })
  })

  it('names how many records it would take back', async () => {
    server(
      { useDevTools: true },
      {
        history: [
          {
            at: '2026-09-04T10:00:00.000Z',
            runs: [{ model: 'User', created: 12, ids: [], failed: [] }],
          },
        ],
      },
    )
    await openTools()

    expect(screen.getByRole('button', { name: 'Undo 12 records' })).toBeTruthy()
  })
})

describe('the danger zone', () => {
  it('asks before emptying one model', async () => {
    const { calls } = server()
    await openTools()

    fireEvent.click(screen.getByRole('button', { name: /Empty User/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('cannot be undone')
    expect(calls).not.toContain('POST /dev/truncate')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete everything' }))
    await waitFor(() => expect(calls).toContain('POST /dev/truncate'))
  })

  it('asks louder before emptying all of them', async () => {
    const { calls } = server()
    await openTools()

    fireEvent.click(screen.getByRole('button', { name: 'Empty every model' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('including the ones you made by hand')
    expect(calls).not.toContain('POST /dev/reset')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Empty everything' }))
    await waitFor(() => expect(calls).toContain('POST /dev/reset'))
  })
})

describe('what it says about faker', () => {
  it('says it is optional rather than missing', async () => {
    // "Install ten megabytes before you can see any data" is the sort of first
    // step that ends an evaluation, so the absence is stated as a fact about
    // the words rather than as something wrong.
    server()
    await openTools()

    expect(screen.getByText('Built-in words')).toBeTruthy()
  })
})
