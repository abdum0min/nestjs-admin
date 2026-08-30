/**
 * Serving the admin UI, and the route collision it has to survive.
 *
 * The API owns `/admin/*`, so `@Get(':model')` would happily read `assets` as a
 * model name. These assert that the UI routes win where they should and lose
 * everywhere else - a guard against someone reordering `controllers: []` later
 * and quietly breaking either half.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { uiAvailable } from '../src/ui/assets.js'
import { createAdminApp } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication

beforeAll(async () => {
  app = await createAdminApp(new InMemoryAdapter({ User: [{ id: 'u1' }], Post: [] }))
})

afterAll(async () => {
  await app.close()
})

const http = () => request(app.getHttpServer())

/**
 * The UI is copied into `dist/` by the build, but these tests run from source,
 * where `dist/admin-ui` exists only after `pnpm build`. Asset-serving
 * assertions are skipped when it is absent so a source-only run stays green;
 * the routing assertions below hold either way and are never skipped.
 */
const BUILT_UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/admin-ui')
const built = uiAvailable(BUILT_UI_ROOT)

describe('the UI and API share /admin without colliding', () => {
  it('routes /admin/meta to the API, not the UI', async () => {
    const { body } = await http().get('/admin/meta').expect(200)
    expect(body.data.models).toBeDefined()
  })

  it('routes /admin/:model to the API', async () => {
    const { body } = await http().get('/admin/User').expect(200)
    expect(body.success).toBe(true)
  })

  it('routes /admin/:model/:id to the API', async () => {
    const { body } = await http().get('/admin/User/u1').expect(200)
    expect(body.data.id).toBe('u1')
  })

  it('never reads "assets" as a model name', async () => {
    // Without the UI controller ordered first this would reach `@Get(':model')`
    // and answer MODEL_NOT_FOUND - a 404 that looks the same but means
    // something entirely different.
    const response = await http().get('/admin/assets/does-not-exist.js')

    expect(response.status).toBe(404)
    expect(response.body?.error?.code).not.toBe('MODEL_NOT_FOUND')
  })

  it('leaves the host application’s own routes alone', async () => {
    // Nothing is mounted outside /admin: no catch-all, no APP_FILTER, no
    // APP_GUARD. A path the module does not own is simply not found.
    await http().get('/some/host/route').expect(404)
  })
})

describe.skipIf(!built)('serving the built UI', () => {
  it('returns the SPA shell at /admin', async () => {
    const response = await http().get('/admin').expect(200)

    expect(response.headers['content-type']).toMatch(/text\/html/)
    expect(response.text).toContain('<div id="root">')
  })

  it('does not cache the shell, which names hashed assets', async () => {
    const response = await http().get('/admin').expect(200)
    expect(response.headers['cache-control']).toBe('no-cache')
  })

  it('serves the asset the shell references, with the right type', async () => {
    const shell = await http().get('/admin').expect(200)
    const match = /\/admin\/assets\/([^"]+\.js)/.exec(shell.text)
    expect(match).not.toBeNull()

    const response = await http().get(`/admin/assets/${match?.[1]}`).expect(200)
    expect(response.headers['content-type']).toMatch(/javascript/)
    expect(response.headers['cache-control']).toContain('immutable')
  })

  it('serves the stylesheet with the right type', async () => {
    const shell = await http().get('/admin').expect(200)
    const match = /\/admin\/assets\/([^"]+\.css)/.exec(shell.text)

    if (match) {
      const response = await http().get(`/admin/assets/${match[1]}`).expect(200)
      expect(response.headers['content-type']).toMatch(/text\/css/)
    }
  })

  it('refuses to read anything outside the assets directory', async () => {
    // The route binds one path segment, and the reader re-checks both the name
    // and the resolved location, so an encoded separator never becomes a path.
    for (const attempt of [
      '..%2F..%2Findex.html',
      '..%2Findex.html',
      '..%2F..%2F..%2Fpackage.json',
      'a%2Fb',
      '.env',
    ]) {
      const response = await http().get(`/admin/assets/${attempt}`)

      expect(response.status).toBe(404)
      expect(response.text).not.toContain('"name":')
    }
  })

  it('treats a bare ".." as the shell, because the HTTP layer normalises it', async () => {
    // `/admin/assets/..` is normalised to `/admin` before routing, so this is
    // the public shell answering - not a file escaping the assets directory.
    // Worth pinning: a future reader seeing a 200 here should know why.
    const response = await http().get('/admin/assets/..').expect(200)
    const shell = await http().get('/admin').expect(200)

    expect(response.text).toBe(shell.text)
  })

  it('has the UI physically present in the package', () => {
    expect(existsSync(join(BUILT_UI_ROOT, 'index.html'))).toBe(true)
  })
})

describe('the UI shell is deliberately unauthenticated', () => {
  it('serves the shell without credentials while the API stays guarded', async () => {
    const { UnauthorizedError } = await import('@nest-admin/core')
    const locked = await createAdminApp(new InMemoryAdapter({ User: [], Post: [] }), {
      authorize() {
        throw new UnauthorizedError()
      },
    })

    // The shell is a static bundle: no records, no schema, identical for every
    // visitor. It learns what exists by calling /admin/meta, which is refused.
    if (built) await request(locked.getHttpServer()).get('/admin').expect(200)

    const { body } = await request(locked.getHttpServer()).get('/admin/meta').expect(401)
    expect(body.error.code).toBe('UNAUTHORIZED')

    await request(locked.getHttpServer()).get('/admin/User').expect(401)

    await locked.close()
  })

  it('does not let a static route become a way around the API', async () => {
    const { UnauthorizedError } = await import('@nest-admin/core')
    const locked = await createAdminApp(new InMemoryAdapter({ User: [{ id: 'u1' }], Post: [] }), {
      authorize() {
        throw new UnauthorizedError()
      },
    })

    // Every path that could return data is refused; only the shell and its
    // assets are public, and neither contains any.
    for (const path of ['/admin/meta', '/admin/User', '/admin/User/u1']) {
      await request(locked.getHttpServer()).get(path).expect(401)
    }

    await locked.close()
  })
})
