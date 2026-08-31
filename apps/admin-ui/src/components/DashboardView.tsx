/**
 * The landing page.
 *
 * Four widget kinds, drawn from data. The interface knows how to render a
 * number, a list, a chart and an application-supplied statistic, and knows
 * nothing else about any of them - no widget name, no model name, no special
 * case. Adding a widget to an application is a line of configuration, not a
 * change here, which is the whole reason the contract is a closed set of four.
 *
 * ## One request, several answers
 *
 * The document arrives whole, and individual widgets inside it may be marked
 * `failed`. So the page has a loading state and an error state for the request,
 * and then a third state per widget - because "the orders count timed out" must
 * not be allowed to look like "the dashboard is down".
 *
 * ## Every widget is a way in
 *
 * A count is a question, and the next thing anyone does with it is look at the
 * rows behind it. So a widget over a model links to that model's list, carrying
 * its filter with it, and the number itself is the link target rather than a
 * "view" affordance tucked in a corner.
 */
import { ArrowDownRight, ArrowRight, ArrowUpRight, TriangleAlert } from 'lucide-react'

import { fetchDashboard } from '../api/client.js'
import type {
  ChartData,
  CountData,
  Dashboard,
  ListData,
  StatData,
  WidgetDescriptor,
} from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { formatNumber } from '../lib/locale.js'
import { href } from '../hooks/use-route.js'
import { cn } from '../lib/utils.js'
import { ErrorState } from './States.jsx'
import { BarChart } from './ui/bar-chart.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.jsx'
import { Skeleton } from './ui/skeleton.jsx'

/**
 * Span to grid classes.
 *
 * A lookup rather than an interpolated `col-span-N`: Tailwind reads the source
 * as text and generates only the classes it finds there, so a computed class
 * name produces markup referring to CSS that was never written. Every one of
 * these appears literally, which is what makes them exist.
 *
 * One column below `sm`, and nothing wider than two until `lg` - a chart at
 * quarter width on a phone is a row of hairlines.
 */
const SPAN: Readonly<Record<number, string>> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'sm:col-span-2 lg:col-span-3',
  4: 'sm:col-span-2 lg:col-span-4',
}

export function DashboardView() {
  const dashboard = useAsync(() => fetchDashboard(), [])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm">An overview of your data.</p>
      </div>

      {dashboard.loading ? (
        <DashboardSkeleton />
      ) : dashboard.error !== undefined ? (
        <ErrorState error={dashboard.error} onRetry={dashboard.reload} />
      ) : dashboard.data === undefined || dashboard.data.widgets.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing to show yet.</p>
      ) : (
        <Loaded dashboard={dashboard.data} />
      )}
    </div>
  )
}

function Loaded({ dashboard }: { readonly dashboard: Dashboard }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {dashboard.widgets.map((widget) => (
          <div key={widget.id} className={SPAN[widget.span] ?? SPAN[1]}>
            <Widget widget={widget} />
          </div>
        ))}
      </div>

      {dashboard.generated ? <GeneratedNote /> : null}
    </>
  )
}

/**
 * Where the default dashboard came from, and how to replace it.
 *
 * Under the widgets rather than above them - it is a note to whoever set the
 * admin up, not to whoever reads the page every morning, and it stops being
 * interesting after the first time. It disappears the moment a dashboard is
 * declared, so it cannot become permanent furniture.
 */
function GeneratedNote() {
  return (
    <p className="text-muted-foreground border-t pt-4 text-xs">
      Built from your schema. Pass a <Code>dashboard</Code> to <Code>AdminModule.forRoot</Code> to
      design your own.
    </p>
  )
}

function Code({ children }: { readonly children: React.ReactNode }) {
  return <code className="bg-muted text-foreground rounded px-1 py-0.5 font-mono">{children}</code>
}

function Widget({ widget }: { readonly widget: WidgetDescriptor }) {
  if (widget.failed) return <FailedWidget widget={widget} />

  switch (widget.kind) {
    case 'count':
    case 'stat':
      return <NumberWidget widget={widget} />
    case 'list':
      return <ListWidget widget={widget} />
    case 'chart':
      return <ChartWidget widget={widget} />
    default:
      // A kind this build does not know. Newer server, older bundle - a real
      // deployment, since the interface ships inside the package and a page may
      // be left open across a restart.
      return null
  }
}

/**
 * The link to the rows behind a widget.
 *
 * `undefined` for a `stat`, which has no model by design, and for anything else
 * without one. The caller then renders a plain card rather than a link that
 * goes nowhere.
 */
function listHref(widget: WidgetDescriptor): string | undefined {
  if (widget.model === undefined) return undefined
  return href({
    kind: 'list',
    model: widget.model,
    ...(widget.filter ? { filter: widget.filter } : {}),
  })
}

function WidgetCard({
  widget,
  children,
}: {
  readonly widget: WidgetDescriptor
  readonly children: React.ReactNode
}) {
  return (
    // Named, so a test - and anyone reading the DOM - can tell where one
    // widget ends and the next begins. Cards elsewhere are not addressed this
    // way; a grid of them is the one place it matters.
    <Card data-slot="widget" className="flex h-full flex-col">
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{widget.title}</CardTitle>
        {widget.description ? (
          <CardDescription className="text-xs">{widget.description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="px-4 pb-4">{children}</CardContent>
    </Card>
  )
}

/**
 * A number, from a model or from the application.
 *
 * `count` and `stat` are one component because they are one thing on the
 * screen: a large figure, a change against some previous period, and a line of
 * context. Where the figure comes from is a difference that belongs entirely on
 * the server.
 */
function NumberWidget({ widget }: { readonly widget: WidgetDescriptor }) {
  const data = widget.data as CountData | StatData | undefined
  const link = listHref(widget)
  const value = data?.value ?? 0

  const figure = (
    <span className="text-3xl font-semibold tracking-tight tabular-nums">
      {typeof value === 'number' ? formatNumber(value) : value}
    </span>
  )

  return (
    <WidgetCard widget={widget}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {link ? (
          // The number is the link. Anyone who reads a count and wants the rows
          // reaches for the count, so that is what has to be clickable.
          <a href={link} className="hover:text-link rounded-sm transition-colors">
            {figure}
          </a>
        ) : (
          figure
        )}
        {data?.delta === undefined ? null : <Delta value={data.delta} />}
      </div>

      {data?.hint ? <p className="text-muted-foreground mt-1 text-xs">{data.hint}</p> : null}
    </WidgetCard>
  )
}

/**
 * A change, as a percentage.
 *
 * Colour is never the only carrier: the arrow points the way the sign does, and
 * the sign is written out. Down is not styled as an error - fewer cancellations
 * is a good week - so the negative case is muted rather than red, and only
 * growth takes the accent.
 */
function Delta({ value }: { readonly value: number }) {
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium tabular-nums',
        up ? 'text-success' : 'text-muted-foreground',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {up ? '+' : ''}
      {value}%
    </span>
  )
}

function ListWidget({ widget }: { readonly widget: WidgetDescriptor }) {
  const data = widget.data as ListData | undefined
  const records = data?.records ?? []
  const link = listHref(widget)
  const model = widget.model

  return (
    <WidgetCard widget={widget}>
      {records.length === 0 ? (
        <p className="text-muted-foreground py-2 text-sm">Nothing yet.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {records.map((record) => {
            const label = <span className="truncate">{record.label}</span>

            return (
              <li key={record.id}>
                {model === undefined ? (
                  <div className="px-2 py-1.5 text-sm">{label}</div>
                ) : (
                  <a
                    href={href({ kind: 'detail', model, id: record.id })}
                    className="hover:bg-accent group flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors"
                  >
                    {label}
                    <ArrowRight
                      className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {link && data && data.total > records.length ? (
        <MoreLink href={link}>View all {formatNumber(data.total)}</MoreLink>
      ) : null}
    </WidgetCard>
  )
}

function ChartWidget({ widget }: { readonly widget: WidgetDescriptor }) {
  const data = widget.data as ChartData | undefined
  const points = data?.points ?? []
  const link = listHref(widget)

  return (
    <WidgetCard widget={widget}>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {formatNumber(data?.total ?? 0)}
        </span>
        <span className="text-muted-foreground text-xs">in this period</span>
      </div>

      {points.length === 0 ? (
        <p className="text-muted-foreground text-sm">No data in this period.</p>
      ) : (
        <BarChart points={points} />
      )}

      {link ? <MoreLink href={link}>View records</MoreLink> : null}
    </WidgetCard>
  )
}

function MoreLink({
  href: to,
  children,
}: {
  readonly href: string
  readonly children: React.ReactNode
}) {
  return (
    <a
      href={to}
      className="text-muted-foreground hover:text-link mt-3 inline-flex items-center gap-1 text-xs transition-colors"
    >
      {children}
      <ArrowRight className="size-3" aria-hidden="true" />
    </a>
  )
}

/**
 * One widget that could not be loaded.
 *
 * Deliberately quiet. The server already decided this was survivable - it sent
 * the rest of the page - so it must not look like the failure of everything
 * around it. It keeps its title and its place in the grid, so nothing reflows
 * and it is obvious which question went unanswered.
 *
 * No cause is shown because none is sent: a `stat` runs application code and
 * its errors carry whatever that code's errors carry. It is in the server log.
 */
function FailedWidget({ widget }: { readonly widget: WidgetDescriptor }) {
  return (
    <WidgetCard widget={widget}>
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <TriangleAlert className="text-warning size-4 shrink-0" aria-hidden="true" />
        Could not be loaded.
      </p>
    </WidgetCard>
  )
}

/**
 * The dashboard before it arrives.
 *
 * The real widget count is not known until the document lands, so this cannot
 * match it exactly. Four narrow cards and two wide ones is the shape the
 * generated dashboard takes and roughly the shape most declared ones do, which
 * keeps the reflow to a row rather than a page.
 */
function DashboardSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      role="status"
      aria-label="Loading dashboard…"
    >
      {[1, 1, 1, 1, 2, 2].map((span, index) => (
        <div key={index} className={SPAN[span]}>
          <Card className="flex h-full flex-col">
            <CardHeader className="px-4 pt-4 pb-2">
              <Skeleton className="h-3.5 w-24" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <Skeleton className={span === 1 ? 'h-8 w-20' : 'h-32 w-full'} />
            </CardContent>
          </Card>
        </div>
      ))}
      <span className="sr-only">Loading dashboard…</span>
    </div>
  )
}
