/**
 * Pages the application adds, beside the ones generated from the schema.
 *
 * ## Why this exists
 *
 * Everything else in this admin is derived: a model becomes a list, a column
 * becomes a field, a relation becomes a picker. That is the whole pitch, and it
 * has one failure mode - the moment an application needs a screen the schema
 * does not imply, the admin becomes something to replace rather than extend.
 * "Reconciliation", "send the weekly digest", "what support needs on one
 * screen": none of those are a table.
 *
 * ## One concept, three bodies
 *
 * A page is a path, a title, and a body. The body is declared one of three
 * ways, and which one to reach for is decided by how much the application wants
 * to write, not by which is better:
 *
 * | Body      | The application writes | Reach for it when                     |
 * | --------- | ---------------------- | ------------------------------------- |
 * | `widgets` | configuration only     | numbers and lists, like the dashboard |
 * | `module`  | a browser module       | its own screen, its own API           |
 * | `url`     | nothing here           | a page that already exists elsewhere  |
 *
 * They are three fillings of one shape rather than three features. A reader who
 * has understood `widgets` already knows where `module` goes.
 *
 * ## What it cannot touch
 *
 * A custom page lives at `#/~<path>`, in the tilde namespace the team, schema
 * and audit screens already use, so it cannot collide with a model however the
 * schema is written. It cannot alter a generated screen, add a field, or change
 * what a list shows. That is the point: the generated admin has to keep working
 * exactly as it did for someone who adds ten pages, or "extensible" is just a
 * word for a second thing to debug.
 *
 * A page that fails is contained - the shell draws the failure in the content
 * area, and navigation and every other page are unaffected.
 */
import type { ExecutionContext } from '@nestjs/common'

import type { ModelIcon } from '@nest-admin/core'

import type { DashboardWidget } from '../dashboard/contract.js'

/** Screens this package already owns in the tilde namespace. */
const RESERVED: readonly string[] = ['team', 'dev', 'schema', 'audit']

/**
 * A path is one lowercase segment.
 *
 * Narrow deliberately. It becomes a URL fragment, a React key, a sidebar entry
 * and part of a server route, and the set of characters safe in all four at
 * once is smaller than the set safe in any one of them.
 */
const SAFE_PATH = /^[a-z0-9][a-z0-9-]{0,63}$/

/** A title that cannot carry markup into the shell. */
const SAFE_TITLE = /^[^<>&"'`\\]{1,64}$/

/**
 * Where a browser module may be fetched from.
 *
 * Root-relative only. An absolute URL here would mean this admin executing code
 * from a host somebody else controls, on a page holding a session that can
 * write to every table - a supply chain the consumer did not choose by writing
 * one line of configuration. Serve the file from your own application.
 */
const SAFE_MODULE = /^\/[A-Za-z0-9._~\-/]*\.m?js$/

/** Where an embedded page may point. Absolute https, or same-origin. */
const SAFE_URL = /^(?:https:\/\/[^\s<>"'`\\]+|\/[^\s<>"'`\\]*)$/

interface Common {
  /**
   * The last segment of its route: `'reports'` is reachable at `#/~reports`.
   *
   * Lowercase letters, digits and dashes. Unique across pages, and not one of
   * the four this package already owns.
   */
  readonly path: string

  /** What the sidebar and the page heading call it. */
  readonly title: string

  /** A sentence under the heading. */
  readonly description?: string

  /** Drawn beside it in the sidebar, from the same set the models use. */
  readonly icon?: ModelIcon

  /**
   * Whether this principal may open it.
   *
   * A function rather than a capability name, because a page belongs to the
   * application and so does the rule about who sees it - `capabilities` is a
   * closed set this package owns, and a page is not one of the things it owns.
   *
   * Omitted means everyone who can reach the admin at all, which is the default
   * a model without `resourceAuth` already has.
   *
   * **Checked on the request, not only on the sidebar.** Withholding a link has
   * never been a permission, so the page route asks this again when the browser
   * asks for the body.
   */
  readonly can?: (context: ExecutionContext) => boolean | Promise<boolean>
}

/**
 * A page built from the dashboard's own vocabulary.
 *
 * No new concepts: the same `count`, `list`, `chart`, `stat` and `activity`
 * widgets, resolved by the same code and authorized the same way - a widget
 * over a model this principal cannot see is absent here exactly as it is there.
 *
 * This is the body most pages want and the one nobody has to learn, which is
 * why it is first. "A second dashboard, about one thing" covers a surprising
 * share of what people build an admin page for.
 */
export interface WidgetPage extends Common {
  readonly widgets: readonly DashboardWidget[]
  // The other two bodies, forbidden rather than merely absent. It is what lets
  // TypeScript tell the three apart from an object literal, and it turns "a
  // page with two bodies" into a compile error rather than only a startup one.
  readonly module?: never
  readonly url?: never
}

/**
 * A page the application writes itself, in the browser.
 *
 * `module` is a root-relative path to an ES module your application serves as a
 * static file. The shell imports it when the route is opened - not before, so a
 * page nobody visits costs nothing - and renders its default export.
 *
 * **No build step, still.** The rule that has held since 0.1.0 does not bend
 * here: the module is handed React, a fetch helper carrying the admin's
 * session, and the admin's own components, on `window.NestAdmin`. Writing a
 * page needs no bundler, no React install and no copy of this package. An
 * application that already builds a frontend may bundle instead, with React
 * marked external.
 *
 * The API behind it is yours. Guard it with the exported `AdminAuthGuard` and it
 * sits behind the same session the admin already established.
 */
export interface ModulePage extends Common {
  readonly module: string
  readonly widgets?: never
  readonly url?: never
}

/**
 * A page that already exists, shown inside the admin's chrome.
 *
 * The escape hatch, and an honest one: an application with a reporting tool, a
 * status board or a legacy screen should not have to rewrite it to put it
 * behind the same navigation.
 *
 * It is sandboxed, and it is a document rather than a component - it cannot
 * read the admin's page, and the admin cannot read it.
 */
export interface EmbedPage extends Common {
  readonly url: string
  readonly widgets?: never
  readonly module?: never
}

export type AdminPage = WidgetPage | ModulePage | EmbedPage

/** Pages, as the application declares them. */
export type AdminPages = readonly AdminPage[]

/*
 * The three guards test for a value, not for a key.
 *
 * `{ widgets: [...], url: undefined }` type-checks, because the excluding keys
 * are `?: never` rather than absent. Testing with `in` would call that page an
 * embed as well as a widget page and refuse it at startup for having two
 * bodies - which is a confusing thing to be told about a page that has one.
 */
export function isWidgetPage(page: AdminPage): page is WidgetPage {
  return page.widgets !== undefined
}

export function isModulePage(page: AdminPage): page is ModulePage {
  return page.module !== undefined
}

export function isEmbedPage(page: AdminPage): page is EmbedPage {
  return page.url !== undefined
}

/**
 * Refuse pages that cannot work, at startup, naming what is wrong.
 *
 * Every one of these is a mistake whose runtime symptom is a blank area of
 * screen with nothing anywhere saying why - a path colliding with the audit
 * screen, two pages at one route, a module URL pointing at a host that is not
 * yours. Startup is where they are cheap to see.
 */
export function unusablePages(pages: AdminPages | undefined): readonly string[] {
  if (!pages) return []

  const problems: string[] = []
  const seen = new Set<string>()

  for (const [index, page] of pages.entries()) {
    const at = `pages[${index}]`

    if (typeof page.path !== 'string' || !SAFE_PATH.test(page.path)) {
      problems.push(
        `${at}.path must be lowercase letters, digits and dashes, ` +
          `received ${JSON.stringify(page.path)}.`,
      )
    } else if (RESERVED.includes(page.path)) {
      problems.push(
        `${at}.path is "${page.path}", which is a screen this admin already has. ` +
          `Reserved: ${RESERVED.join(', ')}.`,
      )
    } else if (seen.has(page.path)) {
      problems.push(`${at}.path is "${page.path}", which an earlier page already claims.`)
    } else {
      seen.add(page.path)
    }

    if (typeof page.title !== 'string' || !SAFE_TITLE.test(page.title)) {
      problems.push(`${at}.title must be plain text of at most 64 characters.`)
    }

    const bodies = [isWidgetPage(page), isModulePage(page), isEmbedPage(page)].filter(
      Boolean,
    ).length

    if (bodies === 0) {
      problems.push(`${at} needs exactly one of \`widgets\`, \`module\` or \`url\`, and has none.`)
    } else if (bodies > 1) {
      problems.push(
        `${at} has more than one of \`widgets\`, \`module\` and \`url\`. ` +
          `A page has one body, and which one it is decides how it is drawn.`,
      )
    }

    if (isWidgetPage(page) && page.widgets.length === 0) {
      problems.push(`${at}.widgets is empty, so the page would draw nothing.`)
    }

    if (isModulePage(page) && !SAFE_MODULE.test(page.module)) {
      problems.push(
        `${at}.module must be a root-relative path to a .js file your application serves, ` +
          `such as "/admin-pages/reports.js", received ${JSON.stringify(page.module)}. ` +
          `An absolute URL is refused: it would run code from another host on a page ` +
          `holding a session that can write to every table.`,
      )
    }

    if (isEmbedPage(page) && !SAFE_URL.test(page.url)) {
      problems.push(
        `${at}.url must be an https URL or a path starting with "/", ` +
          `received ${JSON.stringify(page.url)}.`,
      )
    }
  }

  return problems
}
