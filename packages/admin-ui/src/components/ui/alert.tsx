import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '../../lib/utils.js'

const alertVariants = cva(
  'relative grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm ' +
    '[&>svg]:size-4 [&>svg]:translate-y-0.5 [&:not(:has(svg))]:grid-cols-1',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'border-destructive/40 bg-destructive/8 text-destructive [&>svg]:text-destructive',
        success: 'border-success/40 bg-success/8 [&>svg]:text-success',
        warning: 'border-warning/40 bg-warning/8 [&>svg]:text-warning',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div className={cn(alertVariants({ variant }), className)} {...props} />
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('col-start-2 font-medium', className)} {...props} />
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('col-start-2 text-sm opacity-90 [&_p]:leading-relaxed', className)}
      {...props}
    />
  )
}
