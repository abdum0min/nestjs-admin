/**
 * What an application puts on the dashboard.
 *
 * ## A closed set
 *
 * `count`, `list`, `chart`, `breakdown`, `progress`, `stat`, `activity`. Closed
 * for the same reason `FieldWidget` is: the interface has to know how to draw
 * each one, so an open string would mean rendering nothing and no way to
 * notice.
 *
 * The set grew in 0.19.0 and the two it grew by are the two questions the
 * original four could not answer. `breakdown` answers "how does this divide" -
 * a time series cannot. `progress` answers "is this number good" - a count
 * cannot, because 310 means nothing until you know the target was 400.
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

import type { ModelIcon } from '@nest-admin/core'

/** How wide a widget sits in the four-column grid. */
export type WidgetSpan = 1 | 2 | 3 | 4

/**
 * What a widget's colour is allowed to be.
 *
 * Names rather than hex, and a closed set of five. Each maps to a token the
 * theme already defines, so a widget coloured `success` is green in one palette
 * and a different green in another - and an application that rebrands does not
 * have to find every dashboard colour it wrote down.
 *
 * Five is enough because there are only five things a number on a dashboard
 * means: normal, good, watch this, wrong, and informational.
 */
export type WidgetColor = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'

interface Common {
  /** Shown above it. The one thing every widget needs. */
  readonly title: string
  /** A sentence under the title, when the title cannot carry it alone. */
  readonly description?: string
  /** Columns out of four. Sensible per kind when omitted. */
  readonly span?: WidgetSpan

  /**
   * The colour this card carries.
   *
   * **An accent, not a fill.** The icon sits in a tinted square and a hairline
   * runs down the edge; the card keeps the surface every other card has. A wall
   * of saturated panels is the look of a 2015 Bootstrap template, and it fails
   * twice over: nothing stands out when everything is shouting, and a dark
   * palette has nowhere to put six fully saturated blocks.
   *
   * Left unset, the card is drawn plain, which is right for most of them.
   * Colour is for the two or three that mean something.
   */
  readonly color?: WidgetColor

  /**
   * An icon, from the same closed set the models use.
   *
   * It is what the eye lands on before it reads anything, which is the whole
   * job of a dashboard card: the shape says which number this is, and the
   * number says how much.
   */
  readonly icon?: ModelIcon

  /**
   * Where the card goes when it is clicked, and the label for that.
   *
   * A number on a dashboard is nearly always the beginning of a question, and
   * the answer is a list somewhere. A `count` or `list` already links to its
   * own model; this is for the cards that cannot work out where to send you -
   * a `stat` over three tables, a `progress` toward a target.
   */
  readonly href?: string
  readonly hrefLabel?: string
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

  /**
   * Show these columns, as a small table, instead of one name per row.
   *
   * A column of names answers "what happened recently" and nothing else. Naming
   * columns turns the card into the three or four facts somebody actually wants
   * at a glance - who, how much, what state - which is the difference between
   * the card being a link and the card being an answer.
   *
   * They are drawn by the same code the list screen uses, so an enum arrives as
   * its badge and a number is right-aligned here too. At most four: this is a
   * card, and a fifth column makes it a table that has been squeezed.
   */
  readonly columns?: readonly string[]
}

/** How many records appeared per day, week or month. */
export interface ChartWidget extends Common {
  readonly kind: 'chart'
  readonly model: string
  readonly filter?: string
  readonly bucket?: 'day' | 'week' | 'month'
  /** How many buckets. Thirty by default, ninety at most - see the service. */
  readonly buckets?: number

  /**
   * How the series is drawn. `area` by default.
   *
   * The default changed in 0.19.0 and it was a correction rather than a
   * preference. Thirty daily bars are thirty separate shapes with twenty-nine
   * gaps between them, and the eye has to assemble the trend out of them; a
   * filled line hands over the trend directly, which is the only thing anybody
   * reads a dashboard chart for.
   *
   * `bar` is still right where the buckets are few and genuinely discrete -
   * twelve months, seven weekdays - because then each column is a thing rather
   * than a sample of a continuous one.
   */
  readonly display?: 'area' | 'line' | 'bar'
}

/**
 * How the records divide across one column's values.
 *
 * "Orders by status", "users by role" - the other question a dashboard is
 * asked, and the one a time series cannot answer. It draws as a row of labelled
 * bars, each with its count and its share.
 *
 * ## Only over a column with a known set of values
 *
 * Enums, and booleans. That is not a simplification, it is what makes this
 * possible at all: the counts are one query per value, and a column whose
 * values are not known in advance has no bounded number of them. Naming a free
 * text column here would be asking for a query per distinct customer name.
 *
 * One query per value follows the chart widget, which has run one query per
 * bucket since it existed - and for the same reason. `OrmAdapter` has no
 * `groupBy`, adding one before the 1.0 freeze would put it in every adapter
 * anyone ever writes, and a handful of parallel counts against an indexed
 * column is not worth that.
 */
export interface BreakdownWidget extends Common {
  readonly kind: 'breakdown'
  readonly model: string
  /** The enum or boolean column to divide by. */
  readonly field: string
  /** Narrows what is counted, the same way every other widget's filter does. */
  readonly filter?: string
  /**
   * Draw each value's tone - green for `PAID`, red for `FAILED`.
   *
   * On by default, and inferred from the value's own name the same way a table
   * badge is. `false` draws every bar in one colour, which is right where the
   * values are categories rather than states: `SMALL`, `MEDIUM`, `LARGE` are
   * not good or bad, and colouring them would be decoration.
   */
  readonly tones?: boolean
}

/**
 * How far along something is, against a number somebody chose.
 *
 * The widget that says whether a number is good, which a count cannot: 310
 * means nothing on its own and everything beside a target of 400.
 *
 * The value is a count of a model, or the application's own number - the same
 * two ways every other number on this dashboard arrives.
 */
export interface ProgressWidget extends Common {
  readonly kind: 'progress'
  /** What to count. Omit it and supply `load` instead. */
  readonly model?: string
  readonly filter?: string
  /**
   * The application's own value, for a target that is not a row count.
   *
   * Runs application code, like `stat`, so the application's own rules apply
   * to it - and a failure becomes a card that says it could not load rather
   * than a dashboard that does not.
   */
  readonly load?: (args: {
    readonly context: ExecutionContext
  }) => Promise<ProgressResult> | ProgressResult
  /** What counts as done. Ignored when `load` returns its own target. */
  readonly target?: number
  /** Under the bar. "by the end of March". */
  readonly hint?: string
}

export interface ProgressResult {
  readonly value: number
  readonly target: number
  readonly hint?: string
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

export type DashboardWidget =
  | CountWidget
  | ListWidget
  | ChartWidget
  | BreakdownWidget
  | ProgressWidget
  | StatWidget
  | ActivityWidget

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
  // Three read no model: a stat runs the application's own code, activity is
  // about the admin rather than the data, and a progress widget may be either
  // a count of a model or a number the application works out.
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
    // Labelled bars need room for the label. At a quarter width "Awaiting
    // payment" wraps to three lines and the bar beside it is forty pixels.
    case 'breakdown':
      return 2
    default:
      return 1
  }
}
