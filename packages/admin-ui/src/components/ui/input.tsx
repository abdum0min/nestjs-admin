import type * as React from 'react'

import { cn } from '../../lib/utils.js'

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors',
        'placeholder:text-muted-foreground',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // The refused state is a border *and* an announcement; see RecordForm.
        'aria-invalid:border-destructive aria-invalid:ring-destructive/25 aria-invalid:ring-2',
        className,
      )}
      {...props}
    />
  )
}
