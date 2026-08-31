import type * as React from 'react'

import { cn } from '../../lib/utils.js'

/**
 * The wrapper scrolls, not the page.
 *
 * A table wider than the viewport must take its overflow with it; letting the
 * document scroll sideways moves the navigation off screen along with it.
 */
export function TableWrap({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'bg-card relative w-full overflow-x-auto rounded-xl border shadow-xs',
        // Rows being replaced. Dimmed rather than removed, so a page change
        // does not flash the table out and back - which reads as a bug.
        'aria-busy:opacity-55 transition-opacity',
        className,
      )}
      {...props}
    />
  )
}

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'hover:bg-muted/50 data-[selected=true]:bg-primary/8 border-b transition-colors',
        className,
      )}
      {...props}
    />
  )
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'text-muted-foreground h-10 px-3 text-left align-middle text-xs font-medium tracking-wide uppercase',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />
}
