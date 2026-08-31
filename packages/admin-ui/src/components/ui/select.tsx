/**
 * A select built on Radix.
 *
 * 0.8.0 used the native element and said so in a comment: it is already
 * accessible, already keyboard-operable, and on a phone it opens the platform
 * picker. That reasoning was about capability, and it still holds. What it did
 * not account for is that a native `<select>` cannot be styled - its popup is
 * drawn by the operating system, so it arrives in the system font, with system
 * metrics, in the system's light palette even when the admin is in dark mode.
 * One control that ignores the theme is enough to make the rest look like a
 * skin over something else.
 *
 * So this is the deliberate trade: about forty kilobytes for a listbox that
 * belongs to the same design system as everything around it. The marginal cost
 * is lower than it looks - Radix's positioning engine is shared with the
 * dropdown menu and the popover, so it is paid once.
 *
 * What is *not* given up: the keyboard behaviour. Radix implements the listbox
 * pattern - type-ahead, Home/End, arrow keys, Escape - and the tests below the
 * screens exercise it.
 */
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import type * as React from 'react'

import { cn } from '../../lib/utils.js'

export const Select = SelectPrimitive.Root
export const SelectGroup = SelectPrimitive.Group
export const SelectValue = SelectPrimitive.Value

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'border-input bg-background flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-1 text-sm shadow-xs transition-colors',
        'hover:border-ring/40 data-placeholder:text-muted-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/25 aria-invalid:ring-2',
        '[&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          'bg-popover text-popover-foreground relative z-50 max-h-72 min-w-32 overflow-hidden rounded-md border shadow-md',
          position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 cursor-default items-center justify-center">
          <ChevronUp className="size-4" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 cursor-default items-center justify-center">
          <ChevronDown className="size-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('text-muted-foreground px-2 py-1.5 text-xs font-medium', className)}
      {...props}
    />
  )
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none',
        'focus:bg-accent focus:text-accent-foreground',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

/**
 * The whole control, for the common case.
 *
 * Every select in this interface is "a label, a placeholder, and a flat or
 * grouped list of values". Spelling out five Radix components at each of the
 * eight call sites would be five chances to forget the placeholder or the
 * aria-label, so the shape is written once here.
 */
export function SimpleSelect({
  value,
  onValueChange,
  placeholder,
  options,
  className,
  disabled,
  ...trigger
}: {
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly placeholder: string
  /** A flat list, or groups of them. `value` must never be an empty string. */
  readonly options: readonly (
    | { readonly value: string; readonly label: string }
    | { readonly group: string; readonly items: readonly { value: string; label: string }[] }
  )[]
  readonly className?: string
  readonly disabled?: boolean
} & Omit<React.ComponentProps<typeof SelectPrimitive.Trigger>, 'value' | 'onChange'>) {
  return (
    // Radix reserves the empty string for "nothing selected", so a caller's
    // "no filter" option cannot be one. `NONE` below is that sentinel, and the
    // call sites translate it back.
    <Select
      value={value === '' ? undefined : value}
      onValueChange={onValueChange}
      {...{ disabled }}
    >
      <SelectTrigger className={className} {...trigger}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) =>
          'group' in option ? (
            <SelectGroup key={option.group}>
              <SelectLabel>{option.group}</SelectLabel>
              {option.items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  )
}

/**
 * "No value", as something Radix will accept.
 *
 * Radix treats `value=""` as "nothing is selected" and refuses it on an item,
 * which is reasonable and inconvenient: several of these lists have a real
 * "Default order" or "—" entry that means exactly that. This sentinel carries
 * it, and every call site converts at the boundary.
 */
export const NONE = '__none__'
