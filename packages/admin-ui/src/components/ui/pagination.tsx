/**
 * Numbered pagination.
 *
 * Previous and Next alone answer "is there more?" and nothing else. They do not
 * say how far in you are, they cannot get you to page 40 without forty clicks,
 * and they give no sense of how much there is - which on a table is most of
 * what a pager is for.
 *
 * ## The window, and why it is fixed width
 *
 * The first page, the last page, and a run around the current one, with gaps
 * for the rest. The count of rendered items is deliberately constant: a pager
 * that grows and shrinks as you move through it makes the buttons move under
 * the cursor, so the next click lands on a different number than the one you
 * aimed at.
 */
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'

import { PER_PAGE_OPTIONS } from '../../hooks/use-per-page.js'
import { cn } from '../../lib/utils.js'
import { Button } from './button.jsx'
import { SimpleSelect } from './select.jsx'

/** A page number, or a run of pages that was elided. */
type Slot = number | 'gap'

/**
 * Which page numbers to draw.
 *
 * Always the first and the last, plus `radius` either side of the current one.
 * A gap replaces anything skipped - but only when it stands for more than one
 * page, because "1 … 3" is longer than "1 2 3" and says less.
 */
export function pageSlots(current: number, last: number, radius = 1): readonly Slot[] {
  if (last <= 1) return [1]

  /*
   * The widest this ever gets: the first, the last, the window around the
   * current page, and a gap on each side. Anything shorter than that fits
   * whole, and showing it whole is better than eliding two pages behind an
   * ellipsis that is no shorter than the pages it hides - and it keeps the
   * count steady, which is the property the shape exists for.
   */
  const widest = 2 * radius + 5
  if (last <= widest) return Array.from({ length: last }, (_, index) => index + 1)

  const wanted = new Set<number>([1, last])
  for (let page = current - radius; page <= current + radius; page++) {
    if (page >= 1 && page <= last) wanted.add(page)
  }

  const pages = [...wanted].sort((a, b) => a - b)
  const slots: Slot[] = []

  for (const [index, page] of pages.entries()) {
    const previous = pages[index - 1]
    if (previous !== undefined && page - previous > 1) {
      slots.push(page - previous === 2 ? page - 1 : 'gap')
    }
    slots.push(page)
  }

  return slots
}

export function Pagination({
  page,
  lastPage,
  total,
  perPage,
  onPage,
  onPerPage,
  className,
}: {
  readonly page: number
  readonly lastPage: number
  /** Shown alongside, because "page 3 of 40" and "982 records" answer different questions. */
  readonly total?: number
  /** Current page size. Omit to hide the control - a nested list has no room. */
  readonly perPage?: number
  readonly onPage: (page: number) => void
  readonly onPerPage?: (perPage: number) => void
  readonly className?: string
}) {
  const slots = pageSlots(page, lastPage)

  return (
    <nav
      data-slot="pagination"
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
      aria-label="Pagination"
    >
      <div className="text-muted-foreground flex items-center gap-3 text-sm">
        {total === undefined ? null : (
          <p className="tabular">
            {total} {total === 1 ? 'record' : 'records'}
          </p>
        )}

        {/* Beside the pager rather than in the toolbar above: it is about how
            this page is cut up, which is the question the pager answers. */}
        {perPage !== undefined && onPerPage !== undefined ? (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">Rows</span>
            <SimpleSelect
              className="h-8 w-20"
              aria-label="Rows per page"
              placeholder={String(perPage)}
              value={String(perPage)}
              options={PER_PAGE_OPTIONS.map((size) => ({
                value: String(size),
                label: String(size),
              }))}
              onValueChange={(next) => onPerPage(Number(next))}
            />
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft />
        </Button>

        {slots.map((slot, index) =>
          slot === 'gap' ? (
            <span
              key={`gap-${index}`}
              className="text-muted-foreground flex size-8 items-center justify-center"
              aria-hidden="true"
            >
              <MoreHorizontal className="size-4" />
            </span>
          ) : (
            <Button
              key={slot}
              variant={slot === page ? 'default' : 'ghost'}
              size="icon-sm"
              className="tabular"
              // The page you are on is a state, not a destination. Without
              // this a screen reader reads eight identical buttons.
              aria-current={slot === page ? 'page' : undefined}
              aria-label={`Page ${slot}`}
              onClick={() => onPage(slot)}
            >
              {slot}
            </Button>
          ),
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next page"
          disabled={page >= lastPage}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  )
}
