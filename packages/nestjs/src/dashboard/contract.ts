/**
 * What an application puts on the dashboard.
 *
 * ## A closed set of four
 *
 * `count`, `list`, `chart`, `stat`. Closed for the same reason `FieldWidget` is:
 * the interface has to know how to draw each one, so an open string would mean
 * rendering nothing and no way to notice.
 *
 * Closed here on purpose, and it stayed closed when custom pages arrived. A
 * page written by the application is a `pages` entry with a `module` body,
 * loaded at its own route; the dashboard is still built from widgets this
 * interface knows how to draw. Letting one widget be arbitrary code would have
 * put a consumer's component inside a grid it does not control, on the one
 * screen everybody sees first.
 *
 * ## Three of them are declarative on purpose
 *
 * `count`, `list` and `chart` name a model and a filter; the server does the
 * work. That is not just terseness. A widget that names a model can be
 * *authorized*: one over a resource this principal cannot see is absent from
 * the document, the same way a hidden model and a refused action already are.
 * A widget built from a closure could not be checked, only trusted.
 *
 * `stat` is the escape hatch and has no model, because the number it shows may
 * come from anywhere - a payment processor, a queue, three tables joined. It
 * runs application code, so the application's own rules apply to it.
 *
 * ## Nothing is configured by default
 *
 * An admin with no `dashboard` option still gets one, built from metadata
 * alone: a count per model, and recent records where the schema says when a
 * record was created. Declaring widgets replaces that rather than adding to it,
 * because a dashboard is a page someone designed, and half-designed is worse
 * than either.
 */
import type { ExecutionContext } from '@nestjs/common'

/** How wide a widget sits in the four-column grid. */
export type WidgetSpan = 1 | 2 | 3 | 4

interface Common {
  /** Shown above it. The one thing every widget needs. */
  readonly title: string
  /** A sentence under the title, when the title cannot carry it alone. */
  readonly description?: string
  /** Columns out of four. Sensible per kind when omitted. */
  readonly span?: WidgetSpan
}

/**
 * A single number, from a model.
 *
 * The most common thing on any dashboard, and the reason it is declarative:
 * "how many open orders" is a model, a filter, and nothing else.
 */
export interface CountWidget extends Common {
  readonly kind: 'count'
  readonly model: string
  /** `field:op:value`, the same syntax the list screen's URL uses. */
  readonly filter?: string
  /**
   * Compare against the same count a period ago, and show the change.
   *
   * Needs the model to have a creation timestamp; the comparison is silently
   * omitted when it does not, rather than the widget disappearing.
   */
  readonly compareDays?: number
}

/** A few records, most recent first where the model says which those are. */
export interface ListWidget extends Common {
  readonly kind: 'list'
  readonly model: string
  readonly filter?: string
  /** How many rows. Five by default; more than ten belongs on the list screen. */
  readonly limit?: number
}

/** How many records appeared per day, week or month. */
export interface ChartWidget extends Common {
  readonly kind: 'chart'
  readonly model: string
  readonly filter?: string
  readonly bucket?: 'day' | 'week' | 'month'
  /** How many buckets. Thirty by default, ninety at most - see the service. */
  readonly buckets?: number
}

/**
 * A number the application works out for itself.
 *
 * The escape hatch, and the only widget that runs application code. Whatever it
 * returns is shown; whatever it throws becomes a widget that says it could not
 * load, rather than a dashboard that does not.
 */
export interface StatWidget extends Common {
  readonly kind: 'stat'
  readonly load: (args: { readonly context: ExecutionContext }) => Promise<StatResult> | StatResult
}

export interface StatResult {
  /** Shown large. A string is passed through, so it can carry a currency. */
  readonly value: string | number
  /** A change against some previous period, as a percentage. */
  readonly delta?: number
  /** Under the value. "vs last month", "across 4 regions". */
  readonly hint?: string
}

/**
 * What has been happening in the admin lately.
 *
 * The one widget that is not about the application's data. It appears only
 * where an audit trail is configured and this role may read it, and it is a
 * widget rather than something the dashboard adds on its own so that **where**
 * it sits is the application's decision like every other card here.
 *
 * Declare it nowhere and it is appended at the end at half width, which is a
 * default rather than a placement: a history is context beside the numbers, not
 * the headline above them.
 */
export interface ActivityWidget extends Common {
  readonly kind: 'activity'
  /** How far back the count reaches. Seven days by default. */
  readonly days?: number
  /** How many lines under the number. Five by default. */
  readonly limit?: number
}

export type DashboardWidget = CountWidget | ListWidget | ChartWidget | StatWidget | ActivityWidget

/**
 * The dashboard an application declares.
 *
 * An array rather than a keyed object: a dashboard is read top to bottom, and
 * the order things appear in is part of the design.
 */
export type AdminDashboard = readonly DashboardWidget[]

/** Which model a widget reads, when it reads one. Used to authorize it. */
export function modelOf(widget: DashboardWidget): string | undefined {
  // Two read no model at all: a stat runs the application's own code, and
  // activity is about the admin rather than about the data.
  return widget.kind === 'stat' || widget.kind === 'activity' ? undefined : widget.model
}

/** How wide a widget is when it does not say. */
export function defaultSpan(widget: DashboardWidget): WidgetSpan {
  switch (widget.kind) {
    // A number is small; a chart needs room to be read; a list is a column of
    // rows and looks thin at a quarter width.
    case 'chart':
      return 2
    case 'list':
      return 2
    // Half width: a handful of short lines under a number. Full width was the
    // first thing anybody looking at it asked to change.
    case 'activity':
      return 2
    default:
      return 1
  }
}
