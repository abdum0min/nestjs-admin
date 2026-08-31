import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names, letting the caller win.
 *
 * `clsx` flattens conditionals; `twMerge` resolves Tailwind conflicts by
 * keeping the last one. Without the second half, a component's own `px-3` and
 * a caller's `px-6` would both be emitted and the winner would depend on the
 * order Tailwind happened to write them into the stylesheet - which is not
 * something a caller can reason about.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
