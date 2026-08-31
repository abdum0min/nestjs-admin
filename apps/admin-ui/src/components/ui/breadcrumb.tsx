/**
 * Where you are, and the way back up.
 *
 * The admin is three levels deep at most - resources, a resource, a record -
 * which is exactly the depth at which people stop being sure how they got
 * somewhere. A back link only ever offers the step behind; a trail offers every
 * step, and says what the current page belongs to without being read.
 *
 * The last crumb is the page itself and is not a link. It carries
 * `aria-current="page"`, which is what tells a screen reader that the trail has
 * ended rather than that one item happens to be unclickable.
 */
import { ChevronRight } from 'lucide-react'

import { cn } from '../../lib/utils.js'

export interface Crumb {
  readonly label: string
  /** Absent on the last one: you are already there. */
  readonly href?: string
}

export function Breadcrumb({
  trail,
  className,
}: {
  readonly trail: readonly Crumb[]
  readonly className?: string
}) {
  if (trail.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" data-slot="breadcrumb" className={className}>
      <ol className="text-muted-foreground flex flex-wrap items-center gap-1 text-sm">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? (
                <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
              ) : null}
              {last || crumb.href === undefined ? (
                <span
                  className={cn('max-w-60 truncate', last && 'text-foreground font-medium')}
                  aria-current={last ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              ) : (
                <a
                  href={crumb.href}
                  className="hover:text-foreground max-w-40 truncate underline-offset-4 transition-colors hover:underline"
                >
                  {crumb.label}
                </a>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
