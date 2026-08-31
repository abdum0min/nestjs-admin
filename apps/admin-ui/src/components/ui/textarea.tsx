import type * as React from 'react'

import { cn } from '../../lib/utils.js'

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'border-input bg-background flex min-h-20 w-full rounded-md border px-3 py-2 text-sm shadow-xs transition-colors',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/25 aria-invalid:ring-2',
        className,
      )}
      {...props}
    />
  )
}
