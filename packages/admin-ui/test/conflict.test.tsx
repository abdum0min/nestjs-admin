/**
 * What the person editing sees when somebody got there first.
 *
 * The rule is the server's; this is about the two halves the interface owns.
 * It has to *send* the version - a guard nobody feeds is a guard that never
 * fires - and it has to explain the refusal in a way that says the work on
 * screen is still there.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App.jsx'
import { isSessionProbe, NO_LOGIN_ROUTES } from './no-login.js'

const fetchMock = vi.fn()

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
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

const RECORD = { id: 'u1', name: 'Ada', updatedAt: '2026-01-01T00:00:00.000Z' }

/**
 * @param versioned whether the server nominated a version field, which is what
 *   it does only when the guard is actually running.
 */
function server(options: { versioned?: boolean; conflict?: boolean } = {}) {
  const { versioned = true, conflict = false } = options
  const sent: Array<Record<string, string>> = []

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url)
    if (isSessionProbe(path)) return NO_LOGIN_ROUTES

    if (init?.method === 'PATCH') {
      sent.push((init.headers ?? {}) as Record<string, string>)
      if (conflict) {
        return {
          status: 409,
          ok: false,
          json: async () => ({
            success: false,
            error: {
              code: 'CONFLICT',
              message: 'This record changed after you opened it.',
            },
          }),
        }
      }
      return { status: 200, ok: true, json: async () => ({ success: true, data: RECORD }) }
    }

    if (path.includes('/meta')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          data: {
            capabilities: { manageTeam: false },
            models: [
              {
                name: 'User',
                primaryKey: ['id'],
                displayField: 'name',
                ...(versioned ? { versionField: 'updatedAt' } : {}),
                can: { list: true, read: true, create: true, update: true, delete: true },
                fields: [
                  field('id', { isId: true, isGenerated: true, readOnly: true }),
                  field('name'),
                  field('updatedAt', { kind: 'datetime', isGenerated: true, readOnly: true }),
                ],
              },
            ],
          },
        }),
      }
    }

    return { status: 200, ok: true, json: async () => ({ success: true, data: RECORD }) }
  })

  return sent
}

const openForm = () => {
  window.location.hash = '#/User/u1/edit'
}

const save = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
}

describe('sending the version', () => {
  it('sends the value the form was opened with', async () => {
    const sent = server()
    openForm()
    render(<App />)

    fireEvent.change(await screen.findByLabelText('name'), { target: { value: 'Ada L.' } })
    await save()

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.['x-admin-version']).toBe('2026-01-01T00:00:00.000Z')
  })

  it('sends nothing when the server named no version field', async () => {
    // Which is what it does when the guard is off, or the model has no column
    // recording a change. Sending a header the server ignores would be
    // harmless but misleading in a log.
    const sent = server({ versioned: false })
    openForm()
    render(<App />)

    fireEvent.change(await screen.findByLabelText('name'), { target: { value: 'Ada L.' } })
    await save()

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.['x-admin-version']).toBeUndefined()
  })
})

describe('when the record moved underneath', () => {
  it('says so, and says that nothing was lost', async () => {
    // The important half of the message. "Conflict" alone reads as "your work
    // is gone"; the point is that it is still on the screen.
    server({ conflict: true })
    openForm()
    render(<App />)

    fireEvent.change(await screen.findByLabelText('name'), { target: { value: 'Ada L.' } })
    await save()

    expect(await screen.findByText('Someone else changed this')).toBeTruthy()
    expect(screen.getByText(/Nothing was saved/i)).toBeTruthy()
  })

  it('leaves what was typed in the form', async () => {
    // Nothing was written, so re-typing it would be the interface losing the
    // work the server just protected.
    server({ conflict: true })
    openForm()
    render(<App />)

    const input = await screen.findByLabelText('name')
    fireEvent.change(input, { target: { value: 'Ada L.' } })
    await save()

    await screen.findByText('Someone else changed this')
    expect((input as HTMLInputElement).value).toBe('Ada L.')
  })
})
