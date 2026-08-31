import { useEffect, useRef, type ComponentProps } from 'react'

import { cn } from '../../lib/utils.js'

/**
 * A native checkbox, styled.
 *
 * Not Radix's, for the reason the Select gives - and for one more: the header
 * checkbox in a list has three states, and the third has no HTML attribute.
 * `indeterminate` is a property, set through a ref, and the native element
 * supports it directly. Reimplementing that on a `<button role="checkbox">`
 * means reimplementing the part that was already correct.
 */
export function Checkbox({
  className,
  indeterminate = false,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & {
  /** Some but not all of the set. Has no attribute; only a property. */
  readonly indeterminate?: boolean
}) {
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (box.current) box.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      ref={box}
      type="checkbox"
      className={cn(
        'border-input text-primary accent-primary size-4 shrink-0 cursor-pointer rounded-[4px] border',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
