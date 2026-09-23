/**
 * The landing page.
 *
 * Seven widget kinds, drawn from data. The interface knows how to render a
 * number, a list, a time series, a division, a target, an application-supplied
 * statistic and the admin's own history - and knows nothing else about any of
 * them. No widget name, no model name, no special case. Adding a widget to an
 * application is a line of configuration, not a change here, which is the whole
 * reason the contract is a closed set.
 *
 * ## Colour is emphasis, and emphasis is rationed
 *
 * A card may carry an accent and an icon. Both are opt-in and most cards should
 * have neither: a page where every card is coloured has no emphasis at all, it
 * just has more colours. See `ACCENT` for why the accent is an edge and a tile
 * rather than a filled panel.
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
  ActivityData,
  BreakdownData,
  ChartData,
  CountData,
  Dashboard,
  FieldDescriptor,
  ListData,
  ModelDescriptor,
  ProgressData,
  StatData,
  WidgetColor,
  WidgetDescriptor,
} from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { formatNumber } from '../lib/locale.js'
import { href } from '../hooks/use-route.js'
import { cn } from '../lib/utils.js'
import { columnAlign } from '../metadata/tone.js'
import { modelIcon } from '../metadata/icons.jsx'
import { ALIGN, Value } from './Cell.jsx'
import { ErrorState } from './States.jsx'
import { BarChart } from './ui/bar-chart.jsx'
import { SeriesChart } from './ui/series-chart.jsx'
import { ValueBadge } from './ui/value-badge.jsx'
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

export function DashboardView({ models = [] }: { readonly models?: readonly ModelDescriptor[] }) {
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
        <Loaded dashboard={dashboard.data} models={models} />
      )}
    </div>
  )
}

function Loaded({
  dashboard,
  models,
}: {
  readonly dashboard: Dashboard
  readonly models: readonly ModelDescriptor[]
}) {
  return (
    <>
      <WidgetGrid widgets={dashboard.widgets} models={models} />
      {dashboard.generated ? <GeneratedNote /> : null}
    </>
  )
}

/**
 * The four-column grid, on its own.
 *
 * Exported because a custom page built from `widgets` is the same grid with a
 * different heading above it. Sharing it is what makes the two look like one
 * product rather than two screens that happen to show cards - and it means a
 * widget added here appears on both without anybody remembering to.
 */
export function WidgetGrid({
  widgets,
  models = [],
}: {
  readonly widgets: Dashboard['widgets']
  /**
   * Every model, so a `list` widget that names columns can draw them.
   *
   * A cell is rendered from its field - an enum becomes its badge, a number
   * goes right - and that needs the schema. Passing it here rather than having
   * the widget fetch it keeps the dashboard at one request.
   */
  readonly models?: readonly ModelDescriptor[]
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {widgets.map((widget) => (
        <div key={widget.id} className={SPAN[widget.span] ?? SPAN[1]}>
          <Widget widget={widget} models={models} />
        </div>
      ))}
    </div>
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

function Widget({
  widget,
  models,
}: {
  readonly widget: WidgetDescriptor
  readonly models: readonly ModelDescriptor[]
}) {
  if (widget.failed) return <FailedWidget widget={widget} />

  switch (widget.kind) {
    case 'count':
    case 'stat':
      return <NumberWidget widget={widget} />
    case 'list':
      return <ListWidget widget={widget} models={models} />
    case 'chart':
      return <ChartWidget widget={widget} />
    case 'breakdown':
      return <BreakdownWidget widget={widget} />
    case 'progress':
      return <ProgressWidget widget={widget} />
    case 'activity':
      return <ActivityWidget widget={widget} />
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

/**
 * What a widget's colour does to it.
 *
 * **An accent, not a fill.** A hairline down the leading edge and a tint behind
 * the icon; the card keeps the surface every other card has.
 *
 * The obvious alternative is the one every Bootstrap admin template uses - a
 * solid saturated panel per card - and it fails twice. Nothing stands out when
 * six cards are all shouting, and a dark palette has nowhere to put six fully
 * saturated blocks that does not look like a toy. Emphasis only works if most
 * of the page is quiet.
 *
 * Written out rather than interpolated, because Tailwind generates the classes
 * it finds written in source and nothing else.
 */
const ACCENT: Readonly<Record<WidgetColor, { edge: string; tile: string; ink: string }>> = {
  primary: { edge: 'border-l-primary', tile: 'bg-primary/10', ink: 'text-primary' },
  success: { edge: 'border-l-success', tile: 'bg-success/12', ink: 'text-success' },
  warning: { edge: 'border-l-warning', tile: 'bg-warning/15', ink: 'text-warning' },
  danger: { edge: 'border-l-destructive', tile: 'bg-destructive/12', ink: 'text-destructive' },
  neutral: {
    edge: 'border-l-muted-foreground/40',
    tile: 'bg-muted',
    ink: 'text-muted-foreground',
  },
}

function WidgetCard({
  widget,
  children,
}: {
  readonly widget: WidgetDescriptor
  readonly children: React.ReactNode
}) {
  const accent = widget.color ? ACCENT[widget.color] : undefined
  const Icon = modelIcon(widget.icon)

  return (
    // Named, so a test - and anyone reading the DOM - can tell where one
    // widget ends and the next begins. Cards elsewhere are not addressed this
    // way; a grid of them is the one place it matters.
    <Card
      data-slot="widget"
      className={cn('flex h-full flex-col', accent && `border-l-2 ${accent.edge}`)}
    >
      <CardHeader className="flex flex-row items-start gap-3 px-4 pt-4 pb-2">
        {Icon ? (
          // The thing the eye lands on before it reads. A dashboard is scanned
          // for the card you want, and a shape is found faster than a word.
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg',
              accent?.tile ?? 'bg-muted',
              accent?.ink ?? 'text-muted-foreground',
            )}
            aria-hidden="true"
          >
            <Icon className="size-4.5" />
          </span>
        ) : null}

        <span className="flex min-w-0 flex-col gap-0.5">
          <CardTitle className="text-muted-foreground text-sm font-medium">
            {widget.title}
          </CardTitle>
          {widget.description ? (
            <CardDescription className="text-xs">{widget.description}</CardDescription>
          ) : null}
        </span>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col px-4 pb-4">{children}</CardContent>

      {/* A footer the application asked for, under a rule so it reads as a
          way out of the card rather than as more of its content. */}
      {widget.href === undefined ? null : (
        <a
          href={widget.href}
          className="text-muted-foreground hover:text-link flex items-center gap-1 border-t px-4 py-2 text-xs font-medium transition-colors"
          {...(/^https?:/.test(widget.href) ? { target: '_blank', rel: 'noreferrer' } : {})}
        >
          {widget.hrefLabel ?? 'More'}
          <ArrowRight className="size-3" aria-hidden="true" />
        </a>
      )}
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

function ListWidget({
  widget,
  models,
}: {
  readonly widget: WidgetDescriptor
  readonly models: readonly ModelDescriptor[]
}) {
  const data = widget.data as ListData | undefined
  const records = data?.records ?? []
  const link = listHref(widget)
  const model = widget.model

  /*
   * The columns, only where the schema is here to draw them with.
   *
   * A named column whose field cannot be resolved is dropped rather than
   * printed raw: a cell drawn without its field would lose the badge, the
   * alignment and the date formatting, which is most of the reason to name
   * columns at all. Losing all of them falls back to the list of names, which
   * is what this card has always been.
   */
  const descriptor = models.find((candidate) => candidate.name === model)
  const columns = (data?.columns ?? [])
    .map((name) => descriptor?.fields.find((field) => field.name === name))
    .filter((field): field is FieldDescriptor => field !== undefined)

  if (columns.length > 0 && model !== undefined && records.length > 0) {
    return (
      <WidgetCard widget={widget}>
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-xs">
                {columns.map((column) => (
                  <th
                    key={column.name}
                    scope="col"
                    className={cn('px-4 pb-1.5 font-medium', ALIGN[columnAlign(column)])}
                  >
                    {column.label ?? column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="hover:bg-accent/50 border-b last:border-0">
                  {columns.map((column, index) => (
                    <td key={column.name} className={cn('px-4 py-1.5', ALIGN[columnAlign(column)])}>
                      {/* The first cell carries the link, so the row has one
                          way in rather than a link per cell. */}
                      {index === 0 ? (
                        <a
                          href={href({ kind: 'detail', model, id: record.id })}
                          className="hover:text-link block truncate transition-colors"
                        >
                          <Value field={column} value={record.values?.[column.name]} />
                        </a>
                      ) : (
                        <Value field={column} value={record.values?.[column.name]} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {link && data && data.total > records.length ? (
          <MoreLink href={link}>View all {formatNumber(data.total)}</MoreLink>
        ) : null}
      </WidgetCard>
    )
  }

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
      ) : data?.display === 'bar' ? (
        <BarChart points={points} />
      ) : (
        <SeriesChart points={points} fill={data?.display !== 'line'} />
      )}

      {link ? <MoreLink href={link}>View records</MoreLink> : null}
    </WidgetCard>
  )
}

/**
 * How the records divide, as a row of labelled bars.
 *
 * Bars rather than a pie. A pie asks the eye to compare angles, which it is bad
 * at, and it needs a legend because the labels do not fit inside the slices -
 * so reading one is a lookup. Bars share a baseline, which is the comparison
 * people are actually good at, and the label sits beside its own bar.
 *
 * Each row links to that value filtered on the list screen, because "nine are
 * pending" is a question whose answer is those nine.
 */
function BreakdownWidget({ widget }: { readonly widget: WidgetDescriptor }) {
  const data = widget.data as BreakdownData | undefined
  const slices = data?.slices ?? []
  const model = widget.model

  // Shares are of the largest slice, not of the total. Against the total a
  // realistic distribution - one value holding most of the rows - leaves every
  // other bar a stub, and the comparison between the small ones is lost.
  const peak = Math.max(1, ...slices.map((slice) => slice.count))
  const total = data?.total ?? 0

  if (slices.length === 0) {
    return (
      <WidgetCard widget={widget}>
        <p className="text-muted-foreground py-2 text-sm">Nothing to divide.</p>
      </WidgetCard>
    )
  }

  return (
    <WidgetCard widget={widget}>
      <ul className="flex flex-col gap-2">
        {slices.map((slice) => {
          const row = (
            <>
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">
                  {slice.tone ? (
                    <ValueBadge tone={slice.tone}>{slice.label}</ValueBadge>
                  ) : (
                    slice.label
                  )}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {formatNumber(slice.count)}
                  {total > 0 ? ` · ${Math.round((slice.count / total) * 100)}%` : ''}
                </span>
              </span>
              <span className="bg-muted mt-1 block h-1.5 overflow-hidden rounded-full">
                <span
                  className={cn('block h-full rounded-full', TONE_BAR[slice.tone ?? 'neutral'])}
                  style={{
                    width: `${Math.max((slice.count / peak) * 100, slice.count > 0 ? 2 : 0)}%`,
                  }}
                />
              </span>
            </>
          )

          return (
            <li key={slice.value}>
              {model === undefined || data === undefined ? (
                <div>{row}</div>
              ) : (
                <a
                  href={href({
                    kind: 'list',
                    model,
                    filter: `${data.field}:eq:${slice.value}`,
                  })}
                  className="block rounded-sm"
                >
                  {row}
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </WidgetCard>
  )
}

/** The bar's fill, by tone. Written out for Tailwind's scanner, like `ACCENT`. */
const TONE_BAR: Readonly<Record<string, string>> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-primary',
  neutral: 'bg-primary/60',
}

/**
 * How far a number has got toward one somebody chose.
 *
 * The bar is capped at the target and the figure is not. Past 100% the bar has
 * nothing left to say, and stretching it would make "we beat the goal" look
 * identical to "we met it" - so the overshoot is stated in words instead.
 */
function ProgressWidget({ widget }: { readonly widget: WidgetDescriptor }) {
  const data = widget.data as ProgressData | undefined
  const value = data?.value ?? 0
  const target = data?.target ?? 0
  const share = target > 0 ? Math.min(value / target, 1) : 0
  const percent = target > 0 ? Math.round((value / target) * 100) : 0

  return (
    <WidgetCard widget={widget}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatNumber(value)}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          of {formatNumber(target)}
        </span>
      </div>

      <div
        className="bg-muted mt-2 h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={widget.title}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            TONE_BAR[widget.color === undefined ? 'neutral' : BAR_TONE[widget.color]] ??
              'bg-primary',
          )}
          style={{ width: `${share * 100}%` }}
        />
      </div>

      <p className="text-muted-foreground mt-1.5 text-xs">
        {percent}%{value > target && target > 0 ? ' — past the target' : ''}
        {data?.hint ? ` · ${data.hint}` : ''}
      </p>
    </WidgetCard>
  )
}

/** A widget colour, as the tone its bar should take. */
const BAR_TONE: Readonly<Record<WidgetColor, string>> = {
  primary: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'neutral',
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

/**
 * What has been happening, as one card among the others.
 *
 * It arrives with the rest of the dashboard rather than fetching for itself,
 * so the page is still one request - and it is an ordinary widget, so where it
 * sits and how wide it is are the application's decision like every other card
 * here. It was full width and first, once. That was the first thing anybody
 * looking at it asked to change.
 *
 * The count is the answer; the lines under it are why the answer is that. A
 * number alone sends everybody to the history screen to find out what it was
 * made of.
 */
function ActivityWidget({ widget }: { readonly widget: WidgetDescriptor }) {
  const data = widget.data as ActivityData | undefined
  if (data === undefined) return null

  return (
    <WidgetCard widget={widget}>
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl leading-none font-semibold tabular-nums">
            {formatNumber(data.count)}
          </span>
          <span className="text-muted-foreground text-sm">
            {data.count === 1 ? 'change' : 'changes'} in {data.days} days
          </span>
        </div>

        {data.recent.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {data.recent.map((entry: ActivityData['recent'][number]) => (
              <li key={entry.id} className="flex items-baseline gap-2 py-1.5 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1 truncate">
                  {entry.recordId === undefined || entry.model === '*' ? (
                    entry.summary
                  ) : (
                    <a
                      className="hover:text-link transition-colors"
                      href={href({ kind: 'detail', model: entry.model, id: entry.recordId })}
                    >
                      {entry.summary}
                    </a>
                  )}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">{entry.actor}</span>
              </li>
            ))}
          </ul>
        )}

        <a
          className="text-link inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
          href={href({ kind: 'audit' })}
        >
          All of it
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </a>
      </div>
    </WidgetCard>
  )
}
