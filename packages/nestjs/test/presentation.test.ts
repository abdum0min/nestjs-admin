/**
 * Navigation, and how a model asks to be presented.
 *
 * All of it is presentation, so the tests are about two things that are not:
 * that a misconfiguration fails at startup rather than rendering as nothing,
 * and that the navigation cannot become a way to learn about a model the
 * policy hid.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import type { AdminRoles, RoleResolver } from '../src/auth/roles.js'
import { AdminModule } from '../src/module.js'
import { assertUsableTheme, renderTheme } from '../src/ui/theme.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const boot = async (options: Record<string, unknown> = {}) => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter({ User: [], Post: [] }),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        ...(options as { adapter?: never }),
      }),
    ],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()
  return app.getHttpServer()
}

const meta = async (http: unknown) =>
  (
    await request(http as never)
      .get('/admin/meta')
      .expect(200)
  ).body.data

describe('navigation', () => {
  it('is absent when the application said nothing, so the list stays flat', async () => {
    expect((await meta(await boot())).navigation).toBeUndefined()
  })

  it('groups the models it was given', async () => {
    const http = await boot({
      navigation: [{ heading: 'Content', models: ['Post'] }, { divider: true }],
    })

    expect((await meta(http)).navigation).toEqual([
      { kind: 'group', heading: 'Content', models: ['Post'] },
      { kind: 'divider' },
      // Nothing disappears by being left out.
      { kind: 'group', heading: 'Other', models: ['User'] },
    ])
  })

  it('collects nothing extra when every model is grouped', async () => {
    const http = await boot({
      navigation: [{ heading: 'All', models: ['User', 'Post'] }],
    })

    expect((await meta(http)).navigation).toEqual([
      { kind: 'group', heading: 'All', models: ['User', 'Post'] },
    ])
  })

  it('carries a link out, and marks an absolute one as leaving', async () => {
    const http = await boot({
      navigation: [
        { heading: 'All', models: ['User', 'Post'] },
        { label: 'Docs', href: 'https://example.com/docs', icon: 'file-text' },
        { label: 'Reports', href: '#/Post?filter=title:contains:x' },
      ],
    })

    const [, docs, reports] = (await meta(http)).navigation

    expect(docs).toEqual({
      kind: 'link',
      label: 'Docs',
      href: 'https://example.com/docs',
      icon: 'file-text',
      external: true,
    })
    expect(reports.external).toBe(false)
  })

  /*
   * The navigation is resolved per principal for this reason. A heading with
   * nothing under it is a statement that something exists and was refused,
   * which is exactly what hiding a model is meant to avoid.
   */
  it('drops a group whose models this role cannot see', async () => {
    const roles: AdminRoles = { editor: { models: { Post: ['metadata', 'list', 'read'] } } }
    const roleOf: RoleResolver = () => 'editor'

    const http = await boot({
      roles,
      roleOf,
      navigation: [
        { heading: 'People', models: ['User'] },
        { heading: 'Content', models: ['Post'] },
      ],
    })

    expect((await meta(http)).navigation).toEqual([
      { kind: 'group', heading: 'Content', models: ['Post'] },
    ])
  })

  it('drops a rule that ends up separating nothing', async () => {
    const roles: AdminRoles = { editor: { models: { Post: ['metadata', 'list', 'read'] } } }

    const http = await boot({
      roles,
      roleOf: (() => 'editor') as RoleResolver,
      navigation: [
        { heading: 'People', models: ['User'] },
        { divider: true },
        { heading: 'Content', models: ['Post'] },
      ],
    })

    // The group above the rule is gone, so the rule would have been first.
    expect((await meta(http)).navigation).toEqual([
      { kind: 'group', heading: 'Content', models: ['Post'] },
    ])
  })

  it('refuses a model name the schema does not have, at startup', async () => {
    await expect(boot({ navigation: [{ heading: 'X', models: ['Ordur'] }] })).rejects.toThrow(
      /navigation\[0\] lists "Ordur"/,
    )
  })

  it('refuses the same model in two groups', async () => {
    await expect(
      boot({
        navigation: [
          { heading: 'A', models: ['User'] },
          { heading: 'B', models: ['User'] },
        ],
      }),
    ).rejects.toThrow(/an earlier group claims/)
  })

  it('refuses an href that could execute', async () => {
    await expect(
      boot({ navigation: [{ label: 'Bad', href: 'javascript:alert(1)' }] }),
    ).rejects.toThrow(/must be an http\(s\) URL/)
  })
})

describe('list presentation', () => {
  it('travels with the model', async () => {
    const http = await boot({
      models: {
        Post: {
          list: {
            columns: ['title', 'authorId'],
            sort: { field: 'title', direction: 'desc' },
            perPage: 50,
          },
        },
      },
    })

    const post = (await meta(http)).models.find((model: { name: string }) => model.name === 'Post')

    expect(post.list).toEqual({
      columns: ['title', 'authorId'],
      sort: { field: 'title', direction: 'desc' },
      perPage: 50,
    })
  })

  it('refuses a column the model does not have', async () => {
    await expect(boot({ models: { Post: { list: { columns: ['titel'] } } } })).rejects.toThrow(
      /Post\.list\.columns: titel/,
    )
  })

  it('refuses a sort on a column the model does not have', async () => {
    await expect(
      boot({ models: { Post: { list: { sort: { field: 'nope', direction: 'asc' } } } } }),
    ).rejects.toThrow(/Post\.list\.sort: nope/)
  })
})

describe('detail presentation', () => {
  it('collects whatever no section claimed, so nothing is hidden by a layout', async () => {
    const http = await boot({
      models: {
        Post: {
          detail: {
            layout: 'tabs',
            sections: [{ heading: 'General', fields: ['title', 'body'] }],
          },
        },
      },
    })

    const post = (await meta(http)).models.find((model: { name: string }) => model.name === 'Post')

    expect(post.detail.layout).toBe('tabs')
    expect(post.detail.sections[0]).toEqual({ heading: 'General', fields: ['title', 'body'] })

    const rest = post.detail.sections[1]
    expect(rest.heading).toBe('Other')
    expect(rest.fields).toContain('id')
    expect(rest.fields).toContain('authorId')
  })

  it('defaults to sections when the layout is not named', async () => {
    const http = await boot({
      models: { Post: { detail: { sections: [{ heading: 'General', fields: ['title'] }] } } },
    })

    const post = (await meta(http)).models.find((model: { name: string }) => model.name === 'Post')
    expect(post.detail.layout).toBe('sections')
  })

  it('is absent when the application configured none', async () => {
    const post = (await meta(await boot())).models.find(
      (model: { name: string }) => model.name === 'Post',
    )
    expect(post.detail).toBeUndefined()
  })

  it('refuses a field a section names that the model does not have', async () => {
    await expect(
      boot({ models: { Post: { detail: { sections: [{ heading: 'X', fields: ['nope'] }] } } } }),
    ).rejects.toThrow(/Post\.detail\.sections\[0\]: nope/)
  })
})

describe('the theme', () => {
  it('writes every palette token it was given, per appearance', () => {
    const css = renderTheme({
      colors: {
        light: { background: '#ffffff', mutedForeground: 'oklch(0.53 0.02 258)' },
        dark: { background: 'rgb(10 10 12)' },
      },
    })

    expect(css).toContain(':root{--background:#ffffff;--muted-foreground:oklch(0.53 0.02 258)}')
    expect(css).toContain('.dark{--background:rgb(10 10 12)}')
  })

  /*
   * Both can write `--primary`, and the more specific option is the one that
   * should win. They sit at the same specificity, so the order in the file is
   * the whole mechanism.
   */
  it('lets an explicit token beat the brand colour it derives from', () => {
    const css = renderTheme({ brandColor: '#0b6e6e', colors: { light: { primary: '#ff0000' } } })
    const root = /:root\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(root.indexOf('--primary:#ff0000')).toBeGreaterThan(root.indexOf('--primary:oklch'))
  })

  it('carries the radius and the fonts', () => {
    const css = renderTheme({
      radius: '0',
      fonts: { body: 'Inter, system-ui, sans-serif', stylesheet: 'https://fonts.example/x.css' },
    })

    expect(css).toContain('--radius:0')
    expect(css).toContain('--font-body:Inter, system-ui, sans-serif')
    expect(css).toContain('<link rel="stylesheet" href="https://fonts.example/x.css">')
  })

  it('sends the density to the interface rather than to CSS', () => {
    // It is an attribute on the root element, because the rules that read it
    // are about padding on four surfaces rather than about a value.
    expect(renderTheme({ density: 'compact' })).toContain('"density":"compact"')
  })

  it('appends custom CSS last, after everything it generates', () => {
    const css = renderTheme({ brandColor: '#0b6e6e', customCss: '.admin-x{display:none}' })
    expect(css.indexOf('.admin-x')).toBeGreaterThan(css.indexOf('--primary'))
  })

  it('refuses custom CSS that could end the style element', () => {
    expect(() => assertUsableTheme({ customCss: '</style><script>alert(1)</script>' })).toThrow(
      /must not contain "<"/,
    )
  })

  it('refuses a token it does not have, rather than doing nothing', () => {
    expect(() => assertUsableTheme({ colors: { light: { backgrond: '#fff' } } as never })).toThrow(
      /no token called "backgrond"/,
    )
  })

  it('refuses a value that is not a colour', () => {
    expect(() => assertUsableTheme({ colors: { dark: { background: 'red; }' } } })).toThrow(
      /must be a colour/,
    )
  })

  it('refuses a font stack that could escape the declaration', () => {
    expect(() => assertUsableTheme({ fonts: { body: 'Inter} body{display:none' } })).toThrow(
      /must be a font stack/,
    )
  })

  it('accepts the quotes a real font stack needs', () => {
    expect(() =>
      assertUsableTheme({ fonts: { body: `'Segoe UI', "Helvetica Neue", sans-serif` } }),
    ).not.toThrow()
  })

  it('refuses a font stylesheet that is not https', () => {
    expect(() =>
      assertUsableTheme({ fonts: { stylesheet: 'http://fonts.example/x.css' } }),
    ).toThrow(/must be an https URL/)
  })

  it('refuses a radius that is not a length', () => {
    expect(() => assertUsableTheme({ radius: '12' })).toThrow(/must be a CSS length/)
  })
})
