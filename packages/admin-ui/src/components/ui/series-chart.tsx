/**
 * One series over time, as a line or a filled area.
 *
 * ## Why this exists beside the bar chart
 *
 * Thirty daily bars are thirty separate shapes with twenty-nine gaps between
 * them, and the eye has to assemble the trend out of them. A line hands the
 * trend over directly, which is the only thing anybody reads a dashboard chart
 * for. Bars are still right where the buckets are few and genuinely discrete -
 * twelve months, seven weekdays - because then each column is a thing rather
 * than a sample of a continuous one.
 *
 * ## Still not a chart library
 *
 * The same trade the bar chart wrote down. Recharts is 400 KB and brings three
 * d3 packages; what is needed here is one series, no axis furniture, and a
 * tooltip. That is a path string and a handful of circles.
 *
 * ## The curve is a Catmull-Rom spline, converted to cubic Béziers
 *
 * A polyline through daily counts reads as noise - every sample is a corner.
 * The smoothing is deliberately mild (a sixth of the neighbouring span, the
 * standard tension) so the curve still passes through every real value: a
 * chart that invents a peak between two points is lying about the data.
 *
 * ## The hit targets are not the dots
 *
 * A 2px dot is unhoverable. Each point gets an invisible full-height column,
 * so the tooltip appears anywhere above or below the value - which is where a
 * pointer actually goes.
 */
import { viewerLocale } from '../../lib/locale.js'
import { cn } from '../../lib/utils.js'

export interface SeriesPoint {
  /** An ISO date. Formatted in the viewer's locale for the label. */
  readonly at: string
  readonly value: number
}

/** The drawing height in user units. The viewBox is this tall. */
const H = 100

export function SeriesChart({
  points,
  fill = true,
  className,
  height = 140,
}: {
  readonly points: readonly SeriesPoint[]
  /** Fill under the line. The difference between `area` and `line`. */
  readonly fill?: boolean
  readonly className?: string
  readonly height?: number
}) {
  if (points.length === 0) return null

  const locale = viewerLocale()
  const short = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  const full = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

  // A floor of 1, for the same reason the bar chart has one: an all-zero
  // series is a real answer, and dividing by its peak would produce NaN.
  const peak = Math.max(1, ...points.map((point) => point.value))
  const width = Math.max(points.length - 1, 1) * 10

  const coords = points.map((point, index) => ({
    x: points.length === 1 ? width / 2 : index * 10,
    // Two units of headroom, so the peak is not clipped by the top edge and a
    // dot drawn on it still has room for its radius.
    y: H - (point.value / peak) * (H - 4) - 2,
    point,
  }))

  const line = smoothPath(coords)

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <svg
        viewBox={`0 0 ${width} ${H}`}
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full overflow-visible"
        role="img"
        aria-label={`${points.length} points, peak ${peak}`}
      >
        {fill ? (
          <>
            <defs>
              {/*
                An id that cannot collide.

                Two charts on one dashboard would otherwise share a gradient
                id, and the second definition wins for both - so one chart
                silently takes the other's fill. `useId` is the React answer;
                a constant derived from the data is enough here and needs no
                hook in a component that is otherwise pure.
              */}
              <linearGradient id={`series-${width}-${peak}`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  className="text-primary"
                  stopColor="currentColor"
                  stopOpacity="0.28"
                />
                <stop
                  offset="100%"
                  className="text-primary"
                  stopColor="currentColor"
                  stopOpacity="0.02"
                />
              </linearGradient>
            </defs>
            <path
              d={`${line} L ${width} ${H} L 0 ${H} Z`}
              fill={`url(#series-${width}-${peak})`}
              stroke="none"
            />
          </>
        ) : null}

        <path
          d={line}
          className="stroke-primary"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          // The viewBox is not square and `preserveAspectRatio="none"` stretches
          // it, which would stretch the stroke with it. This keeps the line an
          // even weight at any container width.
          vectorEffect="non-scaling-stroke"
        />

        {coords.map(({ x, y, point }) => (
          <g key={point.at}>
            <circle
              cx={x}
              cy={y}
              r={2}
              className="fill-primary"
              vectorEffect="non-scaling-stroke"
            />
            {/* The hit target: a full-height column, invisible. */}
            <rect x={x - 5} y={0} width={10} height={H} fill="transparent">
              <title>{`${full.format(new Date(point.at))}: ${point.value}`}</title>
            </rect>
          </g>
        ))}
      </svg>

      <div className="text-muted-foreground flex justify-between text-xs">
        <span>{short.format(new Date(points[0]!.at))}</span>
        <span>{short.format(new Date(points.at(-1)!.at))}</span>
      </div>
    </div>
  )
}

/**
 * A path through every point, rounded at the corners.
 *
 * Catmull-Rom to cubic Bézier: each segment's control points are placed a
 * sixth of the way along the vector between the neighbours on either side.
 * Endpoints have only one neighbour, so they stand in for the missing one -
 * which keeps the curve from flaring outward at the ends.
 */
function smoothPath(coords: readonly { x: number; y: number }[]): string {
  const first = coords[0]
  if (first === undefined) return ''
  if (coords.length === 1) return `M ${first.x} ${first.y} L ${first.x} ${first.y}`

  let path = `M ${first.x} ${first.y}`

  for (let index = 0; index < coords.length - 1; index += 1) {
    const previous = coords[index - 1] ?? coords[index]!
    const start = coords[index]!
    const end = coords[index + 1]!
    const next = coords[index + 2] ?? end

    const c1x = start.x + (end.x - previous.x) / 6
    const c1y = start.y + (end.y - previous.y) / 6
    const c2x = end.x - (next.x - start.x) / 6
    const c2y = end.y - (next.y - start.y) / 6

    path += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(end.x)} ${round(end.y)}`
  }

  return path
}

/** Two decimals is well under a pixel here, and keeps the path string short. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}
