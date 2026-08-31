/**
 * A column of bars, in SVG.
 *
 * ## Why this is not a chart library
 *
 * The same reasoning as the calendar. Recharts is 400 KB of source and brings
 * the whole of d3-scale, d3-shape and d3-array with it; what is needed here is
 * "one series, one axis, no interaction beyond a tooltip". Sixty lines of SVG
 * does that, matches the design tokens rather than a `theme` prop, and adds
 * nothing to a bundle that has already grown this release.
 *
 * When the dashboard needs a second series, a legend or a brush, that trade
 * changes and a library is the right answer. It does not need them yet.
 *
 * ## The tooltip is a `<title>`
 *
 * Not a floating div following the pointer. `<title>` inside a shape is the SVG
 * equivalent of `alt` - the browser shows it on hover, a screen reader reads it,
 * it works before any JavaScript runs, and it cannot be positioned wrongly at
 * the edge of a container.
 */
import { viewerLocale } from '../../lib/locale.js'
import { cn } from '../../lib/utils.js'

export interface BarChartPoint {
  /** An ISO date. Formatted in the viewer's locale for the label. */
  readonly at: string
  readonly value: number
}

export function BarChart({
  points,
  className,
  height = 140,
}: {
  readonly points: readonly BarChartPoint[]
  readonly className?: string
  readonly height?: number
}) {
  if (points.length === 0) return null

  const locale = viewerLocale()
  const short = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  const full = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

  /*
   * A floor of 1 on the peak.
   *
   * Every value being zero is a real answer - nothing happened - and dividing
   * by the peak to get a height would divide by zero and produce a chart of
   * NaN. This draws it as a flat empty axis instead, which is what it is.
   */
  const peak = Math.max(1, ...points.map((point) => point.value))

  // A viewBox in bar-units, so the SVG scales with its container and the bar
  // widths never have to be recomputed for a resize.
  const width = points.length * 10

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <svg
        viewBox={`0 0 ${width} 100`}
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full overflow-visible"
        role="img"
        aria-label={`${points.length} points, peak ${peak}`}
      >
        {points.map((point, index) => {
          const scaled = (point.value / peak) * 100
          // A visible stub for a zero, so the axis reads as a row of days
          // rather than as a gap where the chart stopped.
          const barHeight = point.value === 0 ? 1.5 : Math.max(scaled, 2)

          return (
            <rect
              key={point.at}
              x={index * 10 + 1.5}
              y={100 - barHeight}
              width={7}
              height={barHeight}
              rx={1.5}
              className={
                point.value === 0
                  ? 'fill-muted-foreground/25'
                  : 'fill-primary/80 hover:fill-primary'
              }
            >
              <title>{`${full.format(new Date(point.at))}: ${point.value}`}</title>
            </rect>
          )
        })}
      </svg>

      {/* Two labels rather than one per bar: thirty dates along an axis this
          wide are unreadable, and the tooltip already names each one. */}
      <div className="text-muted-foreground flex justify-between text-xs">
        <span>{short.format(new Date(points[0]!.at))}</span>
        <span>{short.format(new Date(points.at(-1)!.at))}</span>
      </div>
    </div>
  )
}
