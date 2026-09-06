/**
 * The schema as a picture.
 *
 * Ten models with three self-relations and two many-to-many pairs is a shape
 * nobody holds in their head from a list of names. Drawn, it is obvious in a
 * second - and the questions it answers are the ones people actually ask when
 * they open somebody else's project: what depends on what, where does an order
 * line live, is this a join table.
 *
 * ## Hand-drawn SVG, and no library
 *
 * The two obvious dependencies cost about a hundred kilobytes (a flow library)
 * and about a megabyte (a diagram renderer) for a screen that draws boxes and
 * lines. This package has one runtime dependency and vendored components; a
 * megabyte for a development screen would be the largest thing in it. Boxes and
 * lines are a few hundred lines of SVG.
 *
 * Layout lives in `metadata/layout.ts` and is deterministic - see the note
 * there about why this is not a physics simulation.
 *
 * ## Not draggable, on purpose
 *
 * Positions somebody arranges have to be stored, and then reconciled with a
 * schema that has changed since. If the automatic layout is good, nobody
 * reaches for the mouse; if it is not, the answer is a better layout rather
 * than asking every reader to fix it by hand.
 */
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { ModelDescriptor } from '../api/types.js'
import { boxFields, hiddenCount, layout, type Box, type Edge } from '../metadata/layout.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.jsx'

/** Where a line leaves and arrives, given the two boxes it joins. */
function anchors(
  from: Box,
  to: Box,
): { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number } {
  const fromRight = from.x + from.width <= to.x
  const toRight = to.x + to.width <= from.x

  // Left and right edges when the boxes are in different columns, which is the
  // common case; centres otherwise, so a line between neighbours still lands
  // somewhere sensible.
  const x1 = fromRight ? from.x + from.width : toRight ? from.x : from.x + from.width / 2
  const x2 = fromRight ? to.x : toRight ? to.x + to.width : to.x + to.width / 2

  return { x1, y1: from.y + from.height / 2, x2, y2: to.y + to.height / 2 }
}

/** A curve rather than a straight line, so two lines between columns separate. */
function curve(from: Box, to: Box): string {
  const { x1, y1, x2, y2 } = anchors(from, to)
  const bend = Math.max(24, Math.abs(x2 - x1) / 2)

  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

/** A relation to the same model: a loop off the right edge. */
function loop(box: Box): string {
  const x = box.x + box.width
  const y = box.y + box.height / 2

  return `M ${x} ${y - 10} C ${x + 46} ${y - 34}, ${x + 46} ${y + 34}, ${x} ${y + 10}`
}

const MARKS: Readonly<Record<Edge['shape'], string>> = {
  'to-one': '1',
  'one-to-many': '1 — ∞',
  'many-to-many': '∞ — ∞',
}

export function SchemaMap({
  models,
  flagged = [],
}: {
  readonly models: readonly ModelDescriptor[]
  /** Models the schema report has something to say about. */
  readonly flagged?: readonly string[]
}) {
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState<string | undefined>(undefined)

  const diagram = useMemo(() => layout(models), [models])
  const boxes = useMemo(
    () => new Map(diagram.boxes.map((box) => [box.model, box])),
    [diagram.boxes],
  )
  const byName = useMemo(() => new Map(models.map((model) => [model.name, model])), [models])
  const alarming = useMemo(() => new Set(flagged), [flagged])

  /** A line is dimmed unless it touches whatever is selected. */
  const involves = (edge: Edge): boolean =>
    selected === undefined || edge.from === selected || edge.to === selected

  if (models.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom out"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((current) => Math.max(0.5, Math.round((current - 0.1) * 10) / 10))}
        >
          <Minus />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom in"
          disabled={zoom >= 1.6}
          onClick={() => setZoom((current) => Math.min(1.6, Math.round((current + 0.1) * 10) / 10))}
        >
          <Plus />
        </Button>
        {selected === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={() => setSelected(undefined)}>
            <RotateCcw />
            Show everything
          </Button>
        )}
        <span className="text-muted-foreground ml-auto text-xs">
          {models.length} models · {diagram.edges.length} relations · dependencies run left to right
        </span>
      </div>

      {/* Its own scroll: a wide schema must not stretch the page sideways. */}
      <div className="bg-muted/30 overflow-auto rounded-lg border p-2">
        <svg
          role="img"
          aria-label="Schema diagram"
          width={diagram.width * zoom}
          height={diagram.height * zoom}
          viewBox={`0 0 ${diagram.width} ${diagram.height}`}
          className="max-w-none"
        >
          <defs>
            <marker
              id="nest-admin-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground" />
            </marker>
          </defs>

          {diagram.edges.map((edge, index) => {
            const from = boxes.get(edge.from)
            const to = boxes.get(edge.to)
            if (!from || !to) return null

            const path = edge.self ? loop(from) : curve(from, to)
            const { x1, y1, x2, y2 } = anchors(from, to)

            return (
              <g
                key={`${edge.from}:${edge.to}:${index}`}
                className={cn('transition-opacity', involves(edge) ? 'opacity-100' : 'opacity-15')}
              >
                <path
                  d={path}
                  fill="none"
                  className="stroke-muted-foreground/50"
                  strokeWidth={1.5}
                  markerEnd="url(#nest-admin-arrow)"
                />
                {edge.self ? null : (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 6}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px]"
                  >
                    {MARKS[edge.shape]}
                  </text>
                )}
              </g>
            )
          })}

          {diagram.boxes.map((box) => {
            const model = byName.get(box.model)
            if (!model) return null

            const active = selected === box.model
            const extra = hiddenCount(model)

            return (
              <g
                key={box.model}
                className="cursor-pointer"
                onClick={() => setSelected(active ? undefined : box.model)}
                role="button"
                aria-label={`${box.model}${active ? ', selected' : ''}`}
              >
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx={8}
                  className={cn(
                    'fill-card stroke-border transition-colors',
                    active && 'stroke-primary',
                    alarming.has(box.model) && !active && 'stroke-destructive/60',
                  )}
                  strokeWidth={active ? 2 : 1}
                />
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={22}
                  rx={8}
                  className={cn('fill-muted', active && 'fill-primary/15')}
                />
                <text
                  x={box.x + 10}
                  y={box.y + 15}
                  className="fill-foreground text-[11px] font-semibold"
                >
                  {box.model}
                </text>

                {boxFields(model).map((field, row) => (
                  <text
                    key={field.name}
                    x={box.x + 10}
                    y={box.y + 38 + row * 17}
                    className={cn(
                      'text-[10px]',
                      field.relation !== undefined
                        ? 'fill-muted-foreground italic'
                        : 'fill-muted-foreground',
                    )}
                  >
                    {field.isId ? '# ' : field.relation !== undefined ? '→ ' : ''}
                    {field.name}
                  </text>
                ))}

                {extra === 0 ? null : (
                  <text
                    x={box.x + 10}
                    y={box.y + box.height - 6}
                    className="fill-muted-foreground text-[9px]"
                  >
                    +{extra} more
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
