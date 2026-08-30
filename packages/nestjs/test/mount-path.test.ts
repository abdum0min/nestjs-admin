/**
 * The admin's mount path.
 *
 * One value has to reach three places that must agree - the router, the asset
 * URLs in the served HTML, and the base the browser builds API URLs from. Any
 * two of them disagreeing produces a blank page and a 404 in a console, so each
 * is asserted here rather than assumed to follow from the others.
 */
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_MOUNT_PATH, normaliseMountPath } from '../src/mount-path.js'
import { UI_BASE_PLACEHOLDER } from '../src/ui/assets.js'
import { createAdminApp } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const boot = async (path?: string): Promise<INestApplication> => {
  app = await createAdminApp(
    new InMemoryAdapter({ User: [{ id: 'u1', email: 'ada@example.com' }], Post: [] }),
    undefined,
    undefined,
    path,
  )
  return app
}

describe('normalising the configured path', () => {
  it('accepts the shapes people actually type', () => {
    for (const input of ['admin', '/admin', 'admin/', '/admin/', '//admin//']) {
      expect(normaliseMountPath(input)).toBe('/admin')
    }
  })

  it('defaults when unset', () => {
    expect(normaliseMountPath(undefined)).toBe(DEFAULT_MOUNT_PATH)
    expect(DEFAULT_MOUNT_PATH).toBe('/admin')
  })

  it('keeps nested paths', () => {
    expect(normaliseMountPath('/internal/admin/')).toBe('/internal/admin')
  })

  it('refuses the root', () => {
    // The routes end in `:model`. At the root they would answer every unmatched
    // request in the host application, and the host's own later routes would
    // fail somewhere far from this option.
    for (const input of ['', '/', '///']) {
      expect(() => normaliseMountPath(input)).toThrow(/cannot be empty/)
    }
  })

  it('refuses route patterns and anything that is not a plain segment', () => {
    for (const input of ['/:model', '/admin/*', '/adm in', '/<script>']) {
      expect(() => normaliseMountPath(input)).toThrow(/plain path segment|not a plain/)
    }
  })

  it('refuses a non-string', () => {
    expect(() => normaliseMountPath(7 as unknown as string)).toThrow(TypeError)
  })
})

describe('serving under the default path', () => {
  it('answers on /admin', async () => {
    const server = (await boot()).getHttpServer()

    await request(server).get('/admin/meta').expect(200)
    await request(server).get('/admin/User').expect(200)
    await request(server).get('/admin').expect(200)
  })
})

describe('serving under a configured path', () => {
  it('moves the API', async () => {
    const server = (await boot('/panel')).getHttpServer()

    await request(server).get('/panel/meta').expect(200)
    await request(server).get('/panel/User').expect(200)
    await request(server).get('/panel/User/u1').expect(200)
  })

  it('leaves nothing behind on the old one', async () => {
    // A path that answers on both is worse than one that answers on neither:
    // it hides the mistake until something else is mounted at /admin.
    const server = (await boot('/panel')).getHttpServer()

    await request(server).get('/admin/meta').expect(404)
    await request(server).get('/admin/User').expect(404)
    await request(server).get('/admin').expect(404)
  })

  it('moves the UI and its assets', async () => {
    const server = (await boot('/panel')).getHttpServer()

    const shell = await request(server).get('/panel').expect(200)
    expect(shell.headers['content-type']).toMatch(/text\/html/)

    const asset = shell.text.match(/src="([^"]+\.js)"/)?.[1]
    expect(asset).toBeDefined()
    await request(server)
      .get(asset as string)
      .expect(200)
  })

  it('still matches assets literally, not as a model name', async () => {
    // The collision rule has to survive being prefixed by the router.
    const server = (await boot('/panel')).getHttpServer()

    const missing = await request(server).get('/panel/assets/nope.js').expect(404)

    expect(JSON.stringify(missing.body)).not.toContain('MODEL_NOT_FOUND')
  })

  it('works nested', async () => {
    const server = (await boot('/internal/admin')).getHttpServer()

    await request(server).get('/internal/admin/meta').expect(200)
    await request(server).get('/internal/admin').expect(200)
  })

  it('accepts an unslashed path', async () => {
    const server = (await boot('panel')).getHttpServer()

    await request(server).get('/panel/meta').expect(200)
  })
})

describe('the served shell', () => {
  it('carries no placeholder once rendered', async () => {
    const shell = await request((await boot('/panel')).getHttpServer())
      .get('/panel')
      .expect(200)

    expect(shell.text).not.toContain(UI_BASE_PLACEHOLDER)
  })

  it('points asset URLs at the mount path', async () => {
    const shell = await request((await boot('/panel')).getHttpServer())
      .get('/panel')
      .expect(200)

    expect(shell.text).toContain('src="/panel/assets/')
    expect(shell.text).toContain('href="/panel/assets/')
  })

  it('hands the base to the browser', async () => {
    // Hash routing means the page cannot infer it from its own URL.
    const shell = await request((await boot('/panel')).getHttpServer())
      .get('/panel')
      .expect(200)

    expect(shell.text).toContain('window.__NEST_ADMIN_BASE__ = "/panel"')
  })

  it('does the same for the default path', async () => {
    const shell = await request((await boot()).getHttpServer())
      .get('/admin')
      .expect(200)

    expect(shell.text).not.toContain(UI_BASE_PLACEHOLDER)
    expect(shell.text).toContain('src="/admin/assets/')
    expect(shell.text).toContain('window.__NEST_ADMIN_BASE__ = "/admin"')
  })
})
