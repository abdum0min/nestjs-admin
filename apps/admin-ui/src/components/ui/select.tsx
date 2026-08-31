import { ChevronDown } from 'lucide-react'
import type * as React from 'react'

import { cn } from '../../lib/utils.js'

/**
 * A native `<select>`, styled.
 *
 * Deliberately not Radix's Select. That component exists to render options as
 * arbitrary markup, which nothing here needs, and it costs about forty
 * kilobytes plus a portal, a focus scope and pointer-event handling that jsdom
 * only partly implements. The native element is already accessible, already
 * keyboard-operable, and on a phone it opens the platform picker - which is
 * better than anything a listbox reimplementation would give.
 */
export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        className={cn(
          'border-input bg-background flex h-9 w-full appearance-none rounded-md border py-1 pr-8 pl-3 text-sm shadow-xs transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-destructive aria-invalid:ring-destructive/25 aria-invalid:ring-2',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
    </div>
  )
}
