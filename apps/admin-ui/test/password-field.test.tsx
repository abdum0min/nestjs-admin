/**
 * The password box, and the rule that makes it usable on an edit.
 *
 * The reveal is the visible half. The half that matters more is what a blank
 * box means: the value is never sent back, so the field is always empty when a
 * form opens - which means "blank" cannot mean "clear it". Without that rule,
 * opening a person and saving anything at all would wipe their password.
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
    field('name'),
    field('secret', { label: 'Password', widget: 'password', writeOnly: true }),
  ],
}

function server() {
  const sent: Record<string, unknown>[] = []

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isSessionProbe(url)) return NO_LOGIN_ROUTES
    const path = String(url).replace('/admin', '')
    if (init?.body) sent.push(JSON.parse(String(init.body)) as Record<string, unknown>)

    return {
      status: 200,
      json: async () =>
        path.startsWith('/meta')
          ? { success: true, data: { models: [MODEL] } }
          : // Note what is *not* here: the server never sends `secret` back.
            { success: true, data: { id: 'u1', name: 'Ada' } },
    } as unknown as Response
  })

  return { sent }
}

const box = () => screen.getByLabelText('Password')

describe('the box', () => {
  it('is masked until you ask', async () => {
    server()
    window.location.hash = '#/User/new'
    render(<App />)
    await screen.findByRole('button', { name: 'Save' })

    expect(box().getAttribute('type')).toBe('password')

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(box().getAttribute('type')).toBe('text')

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(box().getAttribute('type')).toBe('password')
  })

  it('is not offered to a password manager as the visitor own', async () => {
    // It belongs to somebody else's record. A manager filling in its own
    // credentials here would put the wrong secret on someone's account.
    server()
    window.location.hash = '#/User/new'
    render(<App />)
    await screen.findByRole('button', { name: 'Save' })

    expect(box().getAttribute('autocomplete')).toBe('new-password')
  })
})

describe('what a blank box means', () => {
  it('on a create, nothing is sent for it', async () => {
    const { sent } = server()
    window.location.hash = '#/User/new'
    render(<App />)
    await screen.findByRole('button', { name: 'Save' })

    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).not.toHaveProperty('secret')
  })

  it('on an edit, it leaves the stored one alone', async () => {
    /*
     * The rule this file exists for. The ordinary handling of an empty
     * optional field sends `null`, which clears it - and since a write-only
     * field is always blank when a form opens, that would wipe the password of
     * every record anyone opened and saved.
     */
    const { sent } = server()
    window.location.hash = '#/User/u1/edit'
    render(<App />)
    await screen.findByRole('button', { name: 'Save' })

    expect((box() as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).not.toHaveProperty('secret')
  })

  it('but a typed one is sent', async () => {
    const { sent } = server()
    window.location.hash = '#/User/u1/edit'
    render(<App />)
    await screen.findByRole('button', { name: 'Save' })

    fireEvent.change(box(), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ secret: 'hunter2' })
  })
})
