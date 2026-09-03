/**
 * Uploading, and getting it back.
 *
 * Most of this file is about the one attack a file field opens. Upload an HTML
 * document, call it `avatar.png`, declare `Content-Type: image/png`, and if the
 * admin serves it back with the type it was told, the browser renders it - on
 * the admin's own origin, with the session cookie in scope. That is a complete
 * takeover from an avatar field, and it is why nothing here believes the
 * uploader about anything.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import { AdminModule } from '../src/module.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

/** Real bytes, so the sniffer is answering about a real file. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const PDF = Buffer.from('%PDF-1.7\n%¥±ë\n1 0 obj\n', 'latin1')
const HTML = Buffer.from('<script>fetch("/admin/meta").then(r=>r.json())</script>')

const apps: INestApplication[] = []
const directories: string[] = []

async function appWith(files?: { maxSize?: string } | false) {
  const directory = mkdtempSync(join(tmpdir(), 'nest-admin-files-'))
  directories.push(directory)

  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter({ User: [], Post: [] }),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        files: files === false ? false : { directory, ...(files ?? {}) },
      }),
    ],
  }).compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  apps.push(app)
  return { app, directory }
}

const upload = (
  app: INestApplication,
  body: Buffer,
  headers: Record<string, string> = {},
): request.Test =>
  request(app.getHttpServer())
    .post('/admin/files')
    .set('content-type', 'application/octet-stream')
    .set(headers)
    .send(body)

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true })
})

describe('uploading', () => {
  it('stores a file and answers with a key and a URL', async () => {
    const { app } = await appWith()

    const { body } = await upload(app, PNG, { 'x-admin-filename': 'photo.png' }).expect(201)

    expect(body.data.type).toBe('image/png')
    expect(body.data.size).toBe(PNG.byteLength)
    // The key carries the date, something random, and the original name.
    expect(body.data.key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f]{12}-photo\.png$/)
    expect(body.data.url).toBe(`/admin/files/${body.data.key}`)
  })

  it('writes it where it said it would', async () => {
    const { app, directory } = await appWith()
    await upload(app, PNG, { 'x-admin-filename': 'photo.png' }).expect(201)

    // Two levels of date, then the file.
    const year = readdirSync(directory)[0]!
    const month = readdirSync(join(directory, year))[0]!
    expect(readdirSync(join(directory, year, month))[0]).toMatch(/-photo\.png$/)
  })

  it('decodes a name that could not travel as it was written', async () => {
    // An HTTP header is bytes: a browser refuses to put a non-Latin value in
    // one, so the interface percent-encodes it. Without the matching decode a
    // name in another script arrives as a run of escapes and sanitises into
    // dashes - which a real upload found and no test had asked about.
    const { app } = await appWith()

    const { body } = await upload(app, PNG, {
      'x-admin-filename': encodeURIComponent('ҳисобот.png'),
    }).expect(201)

    expect(body.data.key).toMatch(/-ҳисобот.png$/)
  })

  it('names a file that arrives without one', async () => {
    const { app } = await appWith()
    const { body } = await upload(app, PNG).expect(201)
    expect(body.data.key).toMatch(/-file$/)
  })
})

describe('what it refuses', () => {
  it('refuses a type the field does not accept', async () => {
    const { app } = await appWith()

    const { body } = await upload(app, PDF, {
      'x-admin-filename': 'notes.pdf',
      'x-admin-accept': 'image/*',
    }).expect(400)

    expect(body.error.message).toMatch(/image/)
  })

  it('decides the type from the bytes, not from the name or the header', async () => {
    // The whole point. An HTML file called `avatar.png`, announced as a PNG.
    const { app } = await appWith()

    await upload(app, HTML, {
      'x-admin-filename': 'avatar.png',
      'content-type': 'image/png',
      'x-admin-accept': 'image/*',
    }).expect(400)
  })

  it('refuses a file larger than the limit', async () => {
    const { app } = await appWith({ maxSize: '1kb' })

    const big = Buffer.concat([PNG, Buffer.alloc(2048)])
    const { body } = await upload(app, big, { 'x-admin-filename': 'big.png' }).expect(400)

    expect(body.error.message).toMatch(/larger than/)
  })

  it('does not let a header raise the ceiling', async () => {
    // The interface sends the field's own limit, which may only narrow. A
    // header is a request, not a permission.
    const { app } = await appWith({ maxSize: '1kb' })

    const big = Buffer.concat([PNG, Buffer.alloc(2048)])
    await upload(app, big, {
      'x-admin-filename': 'big.png',
      'x-admin-max-size': String(50 * 1024 * 1024),
    }).expect(400)
  })

  it('stores nothing when it refuses', async () => {
    const { app, directory } = await appWith()

    await upload(app, HTML, {
      'x-admin-filename': 'avatar.png',
      'x-admin-accept': 'image/*',
    }).expect(400)

    expect(readdirSync(directory)).toEqual([])
  })
})

describe('serving it back', () => {
  it('returns a picture inline, with the type its bytes say', async () => {
    const { app } = await appWith()
    const { body } = await upload(app, PNG, { 'x-admin-filename': 'photo.png' }).expect(201)

    const response = await request(app.getHttpServer()).get(body.data.url).expect(200)

    expect(response.headers['content-type']).toMatch(/image\/png/)
    expect(response.headers['content-disposition']).toBeUndefined()
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('sends anything else as a download', async () => {
    // A PDF is safe to store and not something to render on this origin.
    const { app } = await appWith()
    const { body } = await upload(app, PDF, { 'x-admin-filename': 'notes.pdf' }).expect(201)

    const response = await request(app.getHttpServer()).get(body.data.url).expect(200)
    expect(response.headers['content-disposition']).toMatch(/attachment/)
  })

  it('refuses a key that climbs out of the directory', async () => {
    // Keys are generated here and cannot contain this today. The check exists
    // for the migration script somebody writes in two years.
    const { app } = await appWith()

    await request(app.getHttpServer())
      .get('/admin/files/..%2f..%2f..%2fetc%2fpasswd')
      .expect((response) => {
        expect(response.status).not.toBe(200)
      })
  })

  it('answers for a key nothing was stored under', async () => {
    const { app } = await appWith()
    await request(app.getHttpServer()).get('/admin/files/2026/01/nothing-here.png').expect(400)
  })
})

describe('when files are turned off', () => {
  it('answers as though the routes are not there', async () => {
    const { app } = await appWith(false)

    await upload(app, PNG, { 'x-admin-filename': 'photo.png' }).expect(500)
    await request(app.getHttpServer()).get('/admin/files/anything.png').expect(500)
  })
})

describe('route order', () => {
  it('does not read `files` as a model name', async () => {
    // The same rule `meta`, `dashboard`, `actions` and `team` rely on. Declared
    // after `:model`, this would answer 404 for a model called "files".
    const { app } = await appWith()
    await request(app.getHttpServer()).get('/admin/files/2026/01/nothing.png').expect(400)
  })
})
