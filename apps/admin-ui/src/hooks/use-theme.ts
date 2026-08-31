/**
 * Light, dark, or whatever the machine says.
 *
 * 0.7.0 followed `prefers-color-scheme` and nothing else, and recorded the
 * consequence as a limitation: a viewer whose operating system disagrees with
 * them had no recourse. This is the recourse.
 *
 * Three states rather than two. "System" is a real choice and the default one -
 * collapsing it into a boolean means a viewer who has expressed no preference
 * is treated as having expressed one, and their machine switching at dusk
 * stops working.
 *
 * The preference is per browser, which is right: it is about this screen in
 * this room, not about the account. So `localStorage`, and every access is
 * wrapped - it throws outright in some privacy modes, and a theme toggle is
 * not worth a blank page.
 */
import { useCallback, useEffect, useState } from 'react'

export type Appearance = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'nest-admin.appearance'

function stored(): Appearance | undefined {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : undefined
  } catch {
    return undefined
  }
}

/** What the application configured, when it configured anything. */
function configured(): Appearance {
  const value = window.__NEST_ADMIN_THEME__?.appearance
  return value === 'light' || value === 'dark' ? value : 'system'
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/** The class the stylesheet keys off. Applied to `<html>`. */
export function applyAppearance(appearance: Appearance): void {
  const dark = appearance === 'dark' || (appearance === 'system' && prefersDark())
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

/** The appearance to start from: the viewer's choice, else the application's. */
export function initialAppearance(): Appearance {
  return stored() ?? configured()
}

export function useTheme(): {
  readonly appearance: Appearance
  readonly resolved: 'light' | 'dark'
  readonly setAppearance: (next: Appearance) => void
} {
  const [appearance, setState] = useState<Appearance>(initialAppearance)
  const [systemDark, setSystemDark] = useState(prefersDark)

  // Following the system means following it as it changes, not once at load.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const listen = (event: MediaQueryListEvent): void => setSystemDark(event.matches)
    query.addEventListener('change', listen)
    return () => query.removeEventListener('change', listen)
  }, [])

  useEffect(() => {
    applyAppearance(appearance)
  }, [appearance, systemDark])

  const setAppearance = useCallback((next: Appearance) => {
    setState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // A preference that cannot be remembered still applies to this page.
    }
  }, [])

  return {
    appearance,
    resolved: appearance === 'dark' || (appearance === 'system' && systemDark) ? 'dark' : 'light',
    setAppearance,
  }
}
