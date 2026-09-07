/**
 * How many rows a page shows.
 *
 * Twenty-five was a constant, and a constant is a guess about a screen and a
 * schema the person choosing it has never seen. A table of five columns on a
 * tall monitor wants a hundred; one of fifteen columns on a laptop wants ten.
 *
 * ## Remembered, and remembered globally
 *
 * Per browser rather than per account - it is about this screen in this room,
 * like the theme and the collapsed sidebar - and one preference for the whole
 * admin rather than one per model. "I like fifty rows" is a statement about how
 * someone reads a table, not about which table.
 *
 * ## The list is closed, and stops at what the server allows
 *
 * The server clamps `perPage` to 100 rather than refusing it, so an option
 * above that would silently do nothing: a person choosing 500 would get 100
 * and no explanation. Offering only what can be delivered is cheaper than
 * explaining afterwards.
 */
import { useCallback, useState } from 'react'

/** Kept in step with `MAX_PER_PAGE` in the Prisma adapter. */
export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const

export const DEFAULT_PER_PAGE = 25

const STORAGE_KEY = 'nest-admin.perPage'

function stored(): number | undefined {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY))
    // Only a value this interface actually offers. A number from an older
    // version - or from someone editing storage - would otherwise become a
    // page size no control can display or change.
    return (PER_PAGE_OPTIONS as readonly number[]).includes(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function usePerPage(configured?: number): {
  readonly perPage: number
  readonly setPerPage: (next: number) => void
} {
  /*
   * The viewer's own choice, then the application's, then twenty-five.
   *
   * That order is the point: the application knows its tables and sets a
   * sensible first impression, and the person reading them knows their screen.
   * Once they have chosen, the configuration stops applying - a preference
   * that gets overruled on every visit is not a preference.
   *
   * A configured size the control cannot show is ignored for the same reason
   * a stored one is: it would be a page size nobody could change.
   */
  const offered =
    configured !== undefined && (PER_PAGE_OPTIONS as readonly number[]).includes(configured)
      ? configured
      : undefined

  const [perPage, setState] = useState<number>(() => stored() ?? offered ?? DEFAULT_PER_PAGE)

  const setPerPage = useCallback((next: number) => {
    setState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      // A preference that cannot be remembered still applies to this page.
    }
  }, [])

  return { perPage, setPerPage }
}
