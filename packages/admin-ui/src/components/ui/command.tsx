import { Command as CommandPrimitive } from 'cmdk'
import { Search } from 'lucide-react'
import type * as React from 'react'

import { cn } from '../../lib/utils.js'
import { Dialog, DialogContent } from './dialog.jsx'

/*
 * Wrapped rather than re-exported.
 *
 * A bare `export const CommandList = CommandPrimitive.List` makes TypeScript
 * infer a type it cannot name without pointing at a path inside pnpm's store -
 * TS2742, and a declaration that would not resolve for anyone else. Wrapping
 * gives each one a type of its own that is written here.
 */
export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={className} {...props} />
}

export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group className={className} {...props} />
}

export function CommandDialog({
  children,
  ...props
}: React.ComponentProps<typeof Dialog> & { readonly children: React.ReactNode }) {
  return (
    <Dialog {...props}>
      <DialogContent className="top-[20%] translate-y-0 overflow-hidden p-0" showClose={false}>
        <CommandPrimitive
          className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium"
          label="Command palette"
        >
          {children}
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  )
}

export function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b px-3">
      <Search className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      <CommandPrimitive.Input
        className={cn(
          'placeholder:text-muted-foreground flex h-11 w-full bg-transparent text-sm outline-hidden',
          className,
        )}
        {...props}
      />
    </div>
  )
}

export function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn('text-muted-foreground py-6 text-center text-sm', className)}
      {...props}
    />
  )
}

export function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm outline-hidden select-none',
        'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}
