/**
 * The file widget.
 *
 * The rules are the server's, so this is about the parts the interface owns:
 * the three ways a file gets in, what a stored key looks like once it is there,
 * and refusing something obviously too large before a hundred megabytes travel.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FileField } from '../src/components/ui/file-field.jsx'

/** `uploadFile` uses XMLHttpRequest, which jsdom has but does not send. */
class FakeUpload {
  static sent: Array<{ headers: Record<string, string>; body: unknown }> = []
  static status = 201
  static response = { success: true, data: { key: '2026/09/abc123-photo.png' } }

  #headers: Record<string, string> = {}
  readonly upload = { addEventListener: () => {} }
  status = 0
  responseText = ''
  #listeners: Record<string, Array<() => void>> = {}

  open(): void {}
  setRequestHeader(name: string, value: string): void {
    this.#headers[name] = value
  }
  addEventListener(event: string, handler: () => void): void {
    ;(this.#listeners[event] ??= []).push(handler)
  }
  send(body: unknown): void {
    FakeUpload.sent.push({ headers: this.#headers, body })
    this.status = FakeUpload.status
    this.responseText = JSON.stringify(FakeUpload.response)
    for (const handler of this.#listeners['load'] ?? []) handler()
  }
}

beforeEach(() => {
  FakeUpload.sent = []
  FakeUpload.status = 201
  FakeUpload.response = { success: true, data: { key: '2026/09/abc123-photo.png' } }
  vi.stubGlobal('XMLHttpRequest', FakeUpload)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const png = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'photo.png', { type: 'image/png' })

describe('an empty field', () => {
  it('offers all three ways in', async () => {
    render(<FileField value="" onChange={() => {}} image />)

    const box = screen.getByRole('button')
    expect(box.textContent).toMatch(/Choose a file/)
    expect(box.textContent).toMatch(/drop one here/)
    expect(box.textContent).toMatch(/paste/)
  })

  it('says what it accepts and how large', async () => {
    render(
      <FileField value="" onChange={() => {}} accept={['application/pdf']} maxSize={2097152} />,
    )

    expect(screen.getByText(/application\/pdf/)).toBeTruthy()
    expect(screen.getByText(/up to 2 MB/)).toBeTruthy()
  })

  it('uploads a dropped file and reports the key', async () => {
    const changes: string[] = []
    render(<FileField value="" onChange={(value) => changes.push(value)} image />)

    fireEvent.drop(screen.getByRole('button'), { dataTransfer: { files: [png()] } })

    await waitFor(() => expect(changes).toEqual(['2026/09/abc123-photo.png']))
    // The name travels in a header, because the body is the file itself.
    expect(FakeUpload.sent[0]?.headers['x-admin-filename']).toBe('photo.png')
    expect(FakeUpload.sent[0]?.headers['x-admin-accept']).toBe('image/*')
  })

  it('uploads a pasted file', async () => {
    // The one nobody expects: a screenshot goes straight in.
    const changes: string[] = []
    render(<FileField value="" onChange={(value) => changes.push(value)} image />)

    fireEvent.paste(screen.getByRole('button'), { clipboardData: { files: [png()] } })
    await waitFor(() => expect(changes).toHaveLength(1))
  })

  it('refuses something obviously too large without sending it', async () => {
    render(<FileField value="" onChange={() => {}} maxSize={2} />)

    fireEvent.drop(screen.getByRole('button'), { dataTransfer: { files: [png()] } })

    expect(await screen.findByText(/larger than/)).toBeTruthy()
    expect(FakeUpload.sent).toHaveLength(0)
  })

  it('shows what the server said when it refuses', async () => {
    FakeUpload.status = 400
    FakeUpload.response = {
      success: false,
      error: { message: 'This field accepts image/*.' },
    } as never

    render(<FileField value="" onChange={() => {}} />)
    fireEvent.drop(screen.getByRole('button'), { dataTransfer: { files: [png()] } })

    expect(await screen.findByText('This field accepts image/*.')).toBeTruthy()
  })
})

describe('a field that already holds a file', () => {
  it('shows the original name, not the key', async () => {
    render(<FileField value="2026/09/abc123-contract.pdf" onChange={() => {}} />)
    expect(screen.getByText('contract.pdf')).toBeTruthy()
  })

  it('previews a picture and links to it', async () => {
    render(<FileField value="2026/09/abc123-photo.png" onChange={() => {}} image />)

    const image = document.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/admin/files/2026/09/abc123-photo.png')
  })

  it('leaves an absolute value alone', async () => {
    // A store with its own URLs - S3, R2 - writes one onto the column, and
    // rewriting it would break every record saved before the store changed.
    render(<FileField value="https://cdn.example.com/a.png" onChange={() => {}} image />)

    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/a.png')
  })

  it('clears the column when removed', async () => {
    const changes: string[] = []
    render(<FileField value="2026/09/abc123-photo.png" onChange={(v) => changes.push(v)} image />)

    fireEvent.click(screen.getByRole('button', { name: /Remove/ }))
    expect(changes).toEqual([''])
  })
})
