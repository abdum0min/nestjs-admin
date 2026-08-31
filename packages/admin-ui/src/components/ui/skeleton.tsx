import type * as React from 'react'

import { cn } from '../../lib/utils.js'

/**
 * A placeholder with the shape of what is coming.
 *
 * Better than a spinner for a table, because it says how much is arriving and
 * keeps the layout from jumping when it does - and `prefers-reduced-motion`
 * stops the pulse for anyone who asked it to.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />
}
