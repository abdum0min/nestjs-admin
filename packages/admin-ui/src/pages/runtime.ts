/**
 * What a custom page module is handed, on `window.NestAdmin`.
 *
 * ## Why a global rather than an import
 *
 * The rule that has held since 0.1.0 is that the consuming application runs no
 * build step. A page module that imported React would need React resolvable in
 * the browser, which means an import map or a bundler - and a *second* copy of
 * React if it got one, which breaks hooks in ways that read as a haunting
 * rather than as an error.
 *
 * A global sidesteps both. The module is a plain `.js` file the application
 * serves as a static asset; it reads what it needs off `window.NestAdmin` and
 * has no dependencies at all. An application that already builds a frontend can
 * bundle instead, marking React external and mapping it to this - the two are
 * the same object.
 *
 * ## What is deliberately not here
 *
 * No component library beyond a handful of primitives. Everything exposed here
 * is API this package has to keep working, and a large surface frozen early is
 * a large surface to regret. Pages that need more should write their own
 * markup: the admin's stylesheet is already on the page, and the CSS custom
 * properties it defines (`--primary`, `--background`, `--border`, …) are the
 * supported way to match the theme, including when the viewer switches it.
 */
import * as React from 'react'

import { request } from '../api/client.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js'
import { Input } from '../components/ui/input.js'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table.js'
import { href, navigate } from '../hooks/use-route.js'

/**
 * A page module's default export.
 *
 * A component taking no props. It is not given the admin's state on purpose -
 * a page that could read the record currently open would be a page coupled to
 * screens it does not own, and those screens are free to change.
 */
export type AdminPageComponent = () => React.ReactNode

export interface AdminPageRuntime {
  /**
   * The React the admin itself is running.
   *
   * The same instance, which is the entire point: a page calling
   * `NestAdmin.React.useState` shares the reconciler with the shell around it.
   */
  readonly React: typeof React

  /**
   * `React.createElement`, shortened.
   *
   * A page written without a build step has no JSX, and `h('div', null, …)`
   * is what that looks like. Named `h` because every no-build React example
   * for fifteen years has called it that.
   */
  readonly h: typeof React.createElement

  /**
   * Fetch, against your own API, carrying the admin's session.
   *
   * A path is relative to the admin's mount point, so `'/reports/weekly'` on
   * an admin at `/admin` reaches `/admin/reports/weekly` - which is where a
   * controller guarded with the exported `AdminAuthGuard` should live, so that
   * one session covers the admin and the page's own endpoints.
   *
   * It throws the same errors the admin's own screens get, so a 403 from your
   * controller reads as a refusal rather than as a parse failure.
   */
  readonly api: typeof request

  /** Build a hash route into the admin: a list, a record, another page. */
  readonly href: typeof href

  /** Go to one. Prefer a real link where the thing is a link. */
  readonly navigate: typeof navigate

  /**
   * A few primitives, so a page can look like the admin without copying it.
   *
   * Deliberately small. See the note at the top of this file.
   */
  readonly ui: {
    readonly Button: typeof Button
    readonly Input: typeof Input
    readonly Badge: typeof Badge
    readonly Card: typeof Card
    readonly CardHeader: typeof CardHeader
    readonly CardTitle: typeof CardTitle
    readonly CardContent: typeof CardContent
    readonly Table: typeof Table
    readonly TableHeader: typeof TableHeader
    readonly TableBody: typeof TableBody
    readonly TableRow: typeof TableRow
    readonly TableHead: typeof TableHead
    readonly TableCell: typeof TableCell
  }
}

const runtime: AdminPageRuntime = {
  React,
  h: React.createElement,
  api: request,
  href,
  navigate,
  ui: {
    Button,
    Input,
    Badge,
    Card,
    CardHeader,
    CardTitle,
    CardContent,
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
  },
}

/**
 * Publish the runtime, once, before any page module is imported.
 *
 * Idempotent and never replaced: a module that captured `window.NestAdmin` at
 * import time must keep working, and swapping the object underneath it would
 * be a bug with no symptom until something reached for a field.
 */
export function installPageRuntime(): AdminPageRuntime {
  const host = window as unknown as { NestAdmin?: AdminPageRuntime }
  host.NestAdmin ??= runtime
  return host.NestAdmin
}
