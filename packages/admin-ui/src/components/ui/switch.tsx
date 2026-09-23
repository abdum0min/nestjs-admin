/**
 * A boolean, as a toggle.
 *
 * ## It is a checkbox underneath
 *
 * Not a `<button role="switch">`, which is what most component libraries ship.
 * A real `<input type="checkbox">` is focusable, tabbable, labelable, toggled
 * by Space, submitted by a form and announced correctly - all before a line of
 * JavaScript runs - and `role="switch"` on top of it changes only how a screen
 * reader names the state: "on" and "off" rather than "checked".
 *
 * Reimplementing the rest on a `<button>` means reimplementing the part that
 * was already right, which is the same reasoning the Checkbox and the Select
 * here already wrote down.
 *
 * ## The track and the knob are drawn from the input
 *
 * `peer-checked:` on the siblings, so there is no state in React deciding what
 * the switch looks like: the DOM's own checked state is the source, and the
 * two cannot disagree. A controlled `checked` prop that got out of step with
 * the element is the classic toggle bug.
 */
import type { ComponentProps } from 'react'

import { cn } from '../../lib/utils.js'

export function Switch({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <span className={cn('relative inline-flex shrink-0 items-center', className)}>
      <input
        type="checkbox"
        role="switch"
        className="peer size-full absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...props}
      />

      {/* The track. `peer-focus-visible` rather than `peer-focus`, so the ring
          appears for a keyboard and not for a pointer. */}
      <span
        aria-hidden="true"
        className={cn(
          'bg-input peer-checked:bg-primary h-5 w-9 rounded-full transition-colors',
          'peer-focus-visible:ring-ring peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
          'peer-focus-visible:ring-offset-background peer-disabled:opacity-50',
        )}
      />

      {/* The knob, riding on top. `translate-x` rather than a left offset, so
          the movement is composited rather than relaid out. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm',
          'transition-transform peer-checked:translate-x-4 peer-disabled:opacity-50',
        )}
      />
    </span>
  )
}
