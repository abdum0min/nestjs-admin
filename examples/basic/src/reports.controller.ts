/**
 * What a consuming application writes to add a page of its own.
 *
 * Three routes, and between them the whole of the `module` page story:
 *
 *   GET /admin/reports/summary       the page's data - the application's own
 *                                    endpoint, behind the admin's own guard
 *   GET /admin-pages/reconciliation.js  the page's code, as a static module
 *   GET /admin-pages/notes.html      a document, for the `url` page to embed
 *
 * The first is the important one. `AdminAuthGuard` is exported by the package,
 * so this endpoint sits behind exactly the session the admin already
 * established - no second login, no second policy, and nothing to keep in
 * sync. Declaring the controller here, in the module that imports
 * `AdminModule.forRoot(...)`, is what lets Nest resolve it.
 *
 * The code is served unguarded on purpose: it is a script with no data in it,
 * and every request it makes is checked when it arrives. Guarding the file
 * would protect nothing and break caching.
 */
import { AdminAuthGuard, AdminExceptionFilter } from '@nest-admin/nestjs'
import { Controller, Get, Header, UseFilters, UseGuards } from '@nestjs/common'

import { PrismaService } from './prisma.service'

@Controller()
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The page's data.
   *
   * An ordinary Nest route doing ordinary Prisma work. Nothing about it is
   * special to this package except the guard - which is the point being made.
   */
  @Get('admin/reports/summary')
  @UseGuards(AdminAuthGuard)
  // Without it, an unauthenticated request answers 500 rather than 401: the
  // guard refuses with this package's error, which is not one of Nest's.
  @UseFilters(AdminExceptionFilter)
  async summary() {
    const [pending, paid, unreviewed, recent] = await Promise.all([
      this.prisma.order.count({ where: { status: 'PENDING' } }),
      this.prisma.order.count({ where: { status: 'PAID' } }),
      this.prisma.product.count({ where: { reviews: { none: {} } } }),
      this.prisma.order.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, total: true, createdAt: true, user: { select: { name: true } } },
      }),
    ])

    return {
      pending,
      paid,
      unreviewed,
      recent: recent.map((order) => ({
        id: order.id,
        who: order.user?.name ?? 'Unknown',
        total: Number(order.total ?? 0),
        at: order.createdAt,
      })),
    }
  }

  /** The page itself. A plain ES module - no build step anywhere. */
  @Get('admin-pages/reconciliation.js')
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  page(): string {
    return RECONCILIATION
  }

  /** A document, so the `url` page has something of ours to embed. */
  @Get('admin-pages/notes.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  notes(): string {
    return NOTES
  }
}

/**
 * A page module, written the way a consumer would write one.
 *
 * No imports, no bundler, no copy of React. It reads what it needs off
 * `window.NestAdmin` - which is the admin's own React instance, so hooks work -
 * and calls its own API through `api`, which carries the session.
 *
 * `h` is `React.createElement`. Without a build step there is no JSX, and this
 * is what that looks like: verbose, and completely dependency-free.
 */
const RECONCILIATION = `
const { h, React, api, href, ui } = window.NestAdmin
const { useEffect, useState } = React
const { Card, CardHeader, CardTitle, CardContent, Button, Badge } = ui

export default function Reconciliation() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = () => {
    setError(null)
    api('/reports/summary')
      .then((response) => setData(response.data))
      .catch((problem) => setError(problem.message || String(problem)))
  }

  useEffect(load, [])

  if (error) return h('p', { className: 'text-destructive text-sm' }, error)
  if (!data) return h('p', { className: 'text-muted-foreground text-sm' }, 'Loading…')

  const stat = (label, value, tone) =>
    h(Card, { key: label }, [
      h(CardHeader, { key: 'h' }, h(CardTitle, null, label)),
      h(CardContent, { key: 'c' }, [
        h('span', { key: 'v', className: 'text-3xl font-semibold tabular-nums' }, value),
        tone ? h(Badge, { key: 'b', className: 'ml-2', variant: tone }, tone) : null,
      ]),
    ])

  return h('div', { className: 'flex flex-col gap-4' }, [
    h('div', { key: 'stats', className: 'grid grid-cols-1 gap-4 sm:grid-cols-3' }, [
      stat('Awaiting payment', data.pending, data.pending > 0 ? 'secondary' : null),
      stat('Paid', data.paid, null),
      stat('Products with no review', data.unreviewed, null),
    ]),

    h(Card, { key: 'recent' }, [
      h(CardHeader, { key: 'h' }, h(CardTitle, null, 'Oldest unpaid orders')),
      h(CardContent, { key: 'c' }, [
        data.recent.length === 0
          ? h('p', { key: 'none', className: 'text-muted-foreground text-sm' }, 'Nothing pending.')
          : h(
              'ul',
              { key: 'list', className: 'divide-y text-sm' },
              data.recent.map((order) =>
                h('li', { key: order.id, className: 'flex items-baseline gap-3 py-2' }, [
                  h(
                    'a',
                    {
                      key: 'link',
                      className: 'min-w-0 flex-1 truncate hover:underline',
                      href: href({ kind: 'detail', model: 'Order', id: order.id }),
                    },
                    order.who,
                  ),
                  h(
                    'span',
                    { key: 'total', className: 'shrink-0 tabular-nums' },
                    order.total.toFixed(2),
                  ),
                ]),
              ),
            ),
        h(Button, { key: 'refresh', className: 'mt-4', variant: 'outline', onClick: load }, 'Refresh'),
      ]),
    ]),
  ])
}
`

/** Something to embed. Deliberately plain: it is somebody else's document. */
const NOTES = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Runbook</title>
    <style>
      body { font: 15px/1.6 system-ui, sans-serif; margin: 0; padding: 24px; color: #1c1917; }
      h1 { font-size: 18px; margin: 0 0 12px; }
      li { margin-bottom: 6px; }
    </style>
  </head>
  <body>
    <h1>Runbook</h1>
    <p>A document served by the application, shown inside the admin's chrome.</p>
    <ul>
      <li>Refunds over 500 need a second approver.</li>
      <li>Unpaid orders are cancelled after 14 days.</li>
      <li>Escalations go to #ops before 18:00.</li>
    </ul>
  </body>
</html>
`
