import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '../../lib/utils.js'

/**
 * Variants are a vocabulary, not decoration.
 *
 * `destructive` is the one that earns its place: an admin's most dangerous
 * controls are the ones that look exactly like its safest, and a delete button
 * that reads as ordinary is how people delete things they meant to open.
 *
 * ## The cursor and the hover are not cosmetic
 *
 * A `<button>` gets `cursor: default` from the user agent - the arrow, the same
 * one the page background has. Every interactive element here therefore says
 * `cursor-pointer` explicitly. It is the cheapest possible signal that
 * something can be pressed, and its absence makes an interface feel dead
 * before anyone can say why.
 *
 * Hover is the other half of that. Each variant moves somewhere visible rather
 * than shifting by two percent, and `active:` presses in, so a click is
 * acknowledged before the request that follows it has returned.
 */
const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ' +
    'transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.98] ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/85 hover:shadow-sm',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/85 hover:shadow-sm',
        outline:
          'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground hover:border-ring/40',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/70',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 gap-1.5 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'size-9',
        'icon-sm': 'size-8 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element instead, keeping the styling. For links. */
    readonly asChild?: boolean
  }) {
  const Component = asChild ? Slot : 'button'
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { buttonVariants }
