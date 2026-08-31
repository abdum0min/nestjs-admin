/**
 * Building the dashboard document.
 *
 * Everything a widget needs is resolved here and sent as data. The interface
 * draws four shapes and never learns what any of them mean - the same
 * arrangement as actions, and for the same reason: a dashboard that needed a UI
 * change per widget would be a dashboard nobody could add to.
 *
 * ## Authorization first, then work
 *
 * A widget over a model this principal cannot list is dropped before anything
 * is queried. Not hidden by the interface - absent from the document, like a
 * hidden model and a refused action. So a dashboard is not a way to count rows
 * of a table you are not allowed to open.
 *
 * ## Failures are per widget
 *
 * One widget that throws becomes one widget that says it could not load. A
 * dashboard is several independent questions on one page, and letting the
 * slowest or the most broken of them take the others down is the wrong shape
 * for that - especially since `stat` runs application code.
 */
import {
  createdFieldFor,
  displayFieldFor,
  type FilterRule,
  type ModelMetadata,
  type OrmAdapter,
  type RecordData,
} from '@nest-admin/core'
import { Logger, type ExecutionContext } from '@nestjs/common'

import { parseFilterExpression } from '../http/query-parser.js'
import {
  defaultSpan,
  modelOf,
  type AdminDashboard,
  type DashboardWidget,
  type WidgetSpan,
} from './contract.js'

const logger = new Logger('NestAdmin')

/** A widget as it crosses the wire. */
export interface WidgetDto {
  readonly id: string
  readonly kind: 'count' | 'list' | 'chart' | 'stat'
  readonly title: string
  readonly description?: string
  readonly span: WidgetSpan
  /** Which model it reads, so the interface can link to it. */
  readonly model?: string
  /** The list screen this widget is a summary of, as `field:op:value`. */
  readonly filter?: string
  /** Whatever the kind needs. Never a function, never a query. */
  readonly data?: unknown
  /** Set instead of `data` when this one failed. Never carries a cause. */
  readonly failed?: boolean
}

export interface DashboardDto {
  readonly widgets: readonly WidgetDto[]
  /** True when nothing was declared and this was built from the schema. */
  readonly generated: boolean
}

export interface CountData {
  readonly value: number
  readonly delta?: number
  readonly hint?: string
}

export interface ListData {
  readonly records: readonly { readonly id: string; readonly label: string }[]
  readonly total: number
}

export interface ChartData {
  readonly points: readonly { readonly at: string; readonly value: number }[]
  readonly total: number
}

/** Ninety buckets is already a wide chart; see `chartOf` for why it is capped. */
const MAX_BUCKETS = 90

const DAY = 86_400_000

export interface DashboardInput {
  readonly adapter: OrmAdapter
  /** Models this principal may list. Already filtered by the policy. */
  readonly models: readonly ModelMetadata[]
  readonly declared: AdminDashboard | undefined
  readonly context: ExecutionContext
  /**
   * What each model is called in this admin.
   *
   * The generated dashboard names models, and a model's name is not
   * necessarily what anyone calls it: an application that labels `User` as
   * "People" would otherwise get "People" in the sidebar and "User" on the
   * dashboard, which reads as two different things.
   *
   * Only the generated widgets use it. A declared widget already carries the
   * title its author wrote, and overriding that would be presumptuous.
   */
  readonly labels?: Readonly<Record<string, string | undefined>>
}

export async function buildDashboard(input: DashboardInput): Promise<DashboardDto> {
  const declared = input.declared
  const generated = declared === undefined || declared.length === 0
  const widgets = generated ? generateFrom(input.models, input.labels ?? {}) : declared

  const visible = new Set(input.models.map((model) => model.name))

  const resolved = await Promise.all(
    widgets
      // Dropped before anything is queried, so a dashboard cannot count rows
      // of a table this principal may not open.
      .filter((widget) => {
        const model = modelOf(widget)
        return model === undefined || visible.has(model)
      })
      .map((widget, index) => resolve(widget, index, input)),
  )

  return { widgets: resolved, generated }
}

/**
 * A dashboard from the schema alone.
 *
 * A count for every model the principal can see, and - for models that record
 * when a row was created - the newest few and a month of activity for the
 * busiest one.
 *
 * "The busiest" is decided by nothing here: the models arrive in the order the
 * configuration put them in, and the first with a creation timestamp is used.
 * Guessing which table matters most would be guessing about a business, and a
 * dashboard that leads with the wrong one is worse than one that leads with the
 * first.
 */
function generateFrom(
  models: readonly ModelMetadata[],
  labels: Readonly<Record<string, string | undefined>>,
): readonly DashboardWidget[] {
  const labelOf = (model: ModelMetadata): string => labels[model.name] ?? model.name

  const widgets: DashboardWidget[] = models.map((model) => ({
    kind: 'count' as const,
    title: labelOf(model),
    model: model.name,
  }))

  const dated = models.filter((model) => createdFieldFor(model) !== undefined)

  const first = dated[0]
  if (first) {
    widgets.push({
      kind: 'chart',
      title: `New ${labelOf(first)}`,
      description: 'Over the last 30 days.',
      model: first.name,
      span: 2,
    })
  }

  for (const model of dated.slice(0, 2)) {
    widgets.push({
      kind: 'list',
      title: `Recent ${labelOf(model)}`,
      model: model.name,
      span: 2,
    })
  }

  return widgets
}

async function resolve(
  widget: DashboardWidget,
  index: number,
  input: DashboardInput,
): Promise<WidgetDto> {
  const base = {
    // Stable within one document, and only used as a React key: a title is not
    // unique and a position changes when a widget above it is dropped.
    id: `${widget.kind}-${index}`,
    kind: widget.kind,
    title: widget.title,
    span: widget.span ?? defaultSpan(widget),
    ...(widget.description !== undefined ? { description: widget.description } : {}),
    ...(widget.kind !== 'stat' ? { model: widget.model } : {}),
    ...(widget.kind !== 'stat' && widget.filter !== undefined ? { filter: widget.filter } : {}),
  } satisfies Omit<WidgetDto, 'data' | 'failed'>

  try {
    return { ...base, data: await dataFor(widget, input) }
  } catch (cause) {
    // One widget, not the page. The message is logged and not forwarded - a
    // `stat` runs application code, and its errors carry whatever that code's
    // errors carry.
    logger.warn(`Dashboard widget "${widget.title}" failed: ${String(cause)}`)
    return { ...base, failed: true }
  }
}

async function dataFor(widget: DashboardWidget, input: DashboardInput): Promise<unknown> {
  switch (widget.kind) {
    case 'stat':
      return widget.load({ context: input.context })
    case 'count':
      return countOf(widget, input)
    case 'list':
      return listOf(widget, input)
    case 'chart':
      return chartOf(widget, input)
  }
}

/**
 * How many records match.
 *
 * Asks for one row and reads the total the adapter already returns, rather than
 * adding a `count` to the `OrmAdapter` contract. That contract is about to be
 * frozen at 1.0 and every method on it is a method every future adapter has to
 * implement; a page total that is already there is not worth one.
 */
async function countOf(
  widget: Extract<DashboardWidget, { kind: 'count' }>,
  input: DashboardInput,
): Promise<CountData> {
  const model = modelFor(widget.model, input)
  const declared = filtersFor(widget.filter, model)

  const page = await input.adapter.list(widget.model, {
    perPage: 1,
    ...(declared.length > 0 ? { filters: declared } : {}),
  })

  if (widget.compareDays === undefined) return { value: page.total }

  const created = createdFieldFor(model)
  // No creation timestamp means no "before". The count is still correct; only
  // the comparison is missing, so the widget loses a line rather than
  // disappearing.
  if (created === undefined) return { value: page.total }

  const since = new Date(Date.now() - widget.compareDays * DAY).toISOString()
  const recent = await input.adapter.list(widget.model, {
    perPage: 1,
    filters: [...declared, { field: created, operator: 'gte', value: since }],
  })

  const before = page.total - recent.total
  return {
    value: page.total,
    // Everything is new when there was nothing before, and dividing by zero to
    // say so would produce Infinity on a brand-new install.
    ...(before > 0 ? { delta: Math.round((recent.total / before) * 100) } : {}),
    hint: `${recent.total} in the last ${widget.compareDays} days`,
  }
}

async function listOf(
  widget: Extract<DashboardWidget, { kind: 'list' }>,
  input: DashboardInput,
): Promise<ListData> {
  const model = modelFor(widget.model, input)
  const created = createdFieldFor(model)
  const label = displayFieldFor(model)
  const key = model.primaryKey[0] ?? 'id'
  const declared = filtersFor(widget.filter, model)

  const page = await input.adapter.list(widget.model, {
    perPage: Math.min(widget.limit ?? 5, 10),
    // Newest first where the model says which those are; otherwise whatever
    // order the adapter returns, which is better than refusing to show a list.
    ...(created ? { sort: [{ field: created, direction: 'desc' as const }] } : {}),
    ...(declared.length > 0 ? { filters: declared } : {}),
  })

  return {
    total: page.total,
    records: page.data.map((record: RecordData) => ({
      id: String(record[key] ?? ''),
      label: readable(record[label]) ?? String(record[key] ?? ''),
    })),
  }
}

/**
 * How many records appeared per bucket.
 *
 * One count per bucket, run concurrently. That is a query per day rather than
 * one grouped query, and it is a deliberate trade: `OrmAdapter` has no
 * `groupBy`, adding one before the 1.0 freeze would put it in every future
 * adapter, and thirty parallel counts against an indexed column is a dashboard
 * that loads in one round trip's worth of wall clock.
 *
 * The bucket count is capped for the same reason it is not unbounded: this is
 * the one place where a configuration value turns directly into a number of
 * queries.
 */
async function chartOf(
  widget: Extract<DashboardWidget, { kind: 'chart' }>,
  input: DashboardInput,
): Promise<ChartData> {
  const model = modelFor(widget.model, input)
  const created = createdFieldFor(model)
  if (created === undefined) {
    throw new Error(`${widget.model} has no creation timestamp, so it cannot be charted.`)
  }

  const bucket = widget.bucket ?? 'day'
  const count = Math.min(widget.buckets ?? 30, MAX_BUCKETS)
  const size = bucket === 'day' ? DAY : bucket === 'week' ? 7 * DAY : 30 * DAY

  const declared = filtersFor(widget.filter, model)

  const now = Date.now()
  const starts = Array.from({ length: count }, (_, index) => now - (count - index) * size)

  const points = await Promise.all(
    starts.map(async (start) => {
      const page = await input.adapter.list(widget.model, {
        perPage: 1,
        filters: [
          ...declared,
          { field: created, operator: 'gte', value: new Date(start).toISOString() },
          { field: created, operator: 'lt', value: new Date(start + size).toISOString() },
        ],
      })
      return { at: new Date(start).toISOString(), value: page.total }
    }),
  )

  return { points, total: points.reduce((sum, point) => sum + point.value, 0) }
}

/**
 * The metadata for a widget's model.
 *
 * Always present in practice - a widget over a model this principal cannot see
 * was dropped before anything got here. Throwing rather than carrying on
 * without it means a widget whose model went missing fails visibly instead of
 * quietly reading the wrong column.
 */
function modelFor(name: string, input: DashboardInput): ModelMetadata {
  const model = input.models.find((candidate) => candidate.name === name)
  if (model === undefined) throw new Error(`${name} is not an exposed model.`)
  return model
}

/**
 * A declared filter, parsed by the same code the list screen's URL goes
 * through - so `active:eq:true` is the boolean in both places, an unknown
 * operator is refused, and a value is coerced against the field it names.
 */
function filtersFor(filter: string | undefined, model: ModelMetadata): readonly FilterRule[] {
  return filter === undefined ? [] : [parseFilterExpression(filter, model)]
}

/** A value worth showing as a label, or nothing. */
function readable(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}
