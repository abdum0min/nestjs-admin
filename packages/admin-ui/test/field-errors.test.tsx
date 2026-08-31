/**
 * Where a refused value is reported.
 *
 * The server now names the fields a failure is about - a duplicate email, a
 * missing required value, a hook that objected to one particular input. What is
 * asserted here is that the interface uses those names: the message goes under
 * the input it is about, and the banner is kept for failures that name nothing
 * the form can point at.
 *
 * The distinction matters because a banner above a form is a message the person
 * has to translate into an action ("which box?"), and the whole point of the
 * server naming the field is that they should not have to.
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

const MODEL = {
  name: 'User',
  primaryKey: ['id'],
  displayField: 'name',
  can: { list: true, read: true, create: true, update: true, delete: true },
  fields: [
    field('id', { isId: true, isGenerated: true, readOnly: true }),
    field('email', { isRequired: true, isUnique: true }),
    field('name'),
  ],
}

/** A server that accepts the metadata request and refuses every write. */
function refusing(error: { code: string; message: string; details?: unknown }, status = 409) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')

    if (init?.method === 'POST') {
      return {
        status,
        json: async () => ({ success: false, error }),
      } as unknown as Response
    }

    return {
      status: 200,
      json: async () =>
        path.startsWith('/meta')
          ? { success: true, data: { models: [MODEL] } }
          : { success: true, data: [], meta: { total: 0, page: 1, perPage: 25 } },
    } as unknown as Response
  })
}

async function openCreateForm(): Promise<void> {
  window.location.hash = '#/User/new'
  render(<App />)
  await screen.findByRole('button', { name: 'Save' })
}

async function submit(email = 'taken@example.com'): Promise<void> {
  fireEvent.change(screen.getByLabelText('email *'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('a failure that names a field', () => {
  const DUPLICATE = {
    code: 'CONSTRAINT_VIOLATION',
    message: 'Another User already has this email.',
    details: { constraint: 'unique', fields: ['email'] },
  }

  it('shows the message under that input', async () => {
    refusing(DUPLICATE)
    await openCreateForm()
    await submit()

    const message = await screen.findByRole('alert')
    expect(message.textContent).toBe('Another User already has this email.')
    // Inside the row for `email`, not floating above the form.
    expect(screen.getByLabelText('email *').closest('[data-slot="field"]')).toContain(message)
  })

  it('marks the input invalid and points the reader at the message', async () => {
    refusing(DUPLICATE)
    await openCreateForm()
    await submit()

    await screen.findByRole('alert')
    const input = screen.getByLabelText('email *')

    expect(input.getAttribute('aria-invalid')).toBe('true')
    // The colour is not the message; this is what a screen reader follows.
    expect(input.getAttribute('aria-describedby')).toBe(
      screen.getByRole('alert').getAttribute('id'),
    )
  })

  it('does not also show a banner', async () => {
    refusing(DUPLICATE)
    await openCreateForm()
    await submit()

    await screen.findByRole('alert')
    expect(document.querySelectorAll('[data-slot="error-state"]')).toHaveLength(0)
  })

  it('clears the message once that value is changed', async () => {
    refusing(DUPLICATE)
    await openCreateForm()
    await submit()

    await screen.findByRole('alert')
    fireEvent.change(screen.getByLabelText('email *'), { target: { value: 'free@example.com' } })

    // The message was about the value that was sent. That value is gone.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByLabelText('email *').hasAttribute('aria-invalid')).toBe(false)
  })

  it('leaves a message on a different field alone', async () => {
    refusing(DUPLICATE)
    await openCreateForm()
    await submit()

    await screen.findByRole('alert')
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Someone' } })

    expect(screen.getByRole('alert').textContent).toMatch(/already has this email/)
  })
})

describe('a failure the form cannot attach', () => {
  it('falls back to the banner when no field is named', async () => {
    refusing({ code: 'VALIDATION_ERROR', message: 'This account is not allowed to exist.' }, 400)
    await openCreateForm()
    await submit()

    expect((await screen.findByRole('alert')).textContent).toMatch(/not allowed to exist/)
  })

  it('falls back to the banner when the named field is not on the form', async () => {
    // A hidden or read-only column can still be the cause. Silently dropping
    // the message would leave a submission that appears to do nothing.
    refusing({
      code: 'CONSTRAINT_VIOLATION',
      message: 'Another User already has this tenantId.',
      details: { constraint: 'unique', fields: ['tenantId'] },
    })
    await openCreateForm()
    await submit()

    expect((await screen.findByRole('alert')).textContent).toMatch(/already has this tenantId/)
    expect(document.querySelectorAll('[data-slot="error-state"]')).toHaveLength(1)
  })

  it('ignores a details shape it does not recognise', async () => {
    // `details` is free-form on the wire. A form that trusted it would break.
    refusing({
      code: 'CONSTRAINT_VIOLATION',
      message: 'Refused.',
      details: { fields: 'email' },
    })
    await openCreateForm()
    await submit()

    expect((await screen.findByRole('alert')).textContent).toMatch(/Refused./)
  })
})

describe('a refusal naming several fields', () => {
  it('shows the message under each of them', async () => {
    refusing(
      {
        code: 'CONSTRAINT_VIOLATION',
        message: 'email, name is required.',
        details: { constraint: 'required', fields: ['email', 'name'] },
      },
      400,
    )
    await openCreateForm()
    await submit()

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(screen.getByLabelText('email *').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('name').getAttribute('aria-invalid')).toBe('true')
  })
})
