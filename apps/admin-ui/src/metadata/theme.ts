/**
 * Branding the server injected into the page.
 *
 * Read once, at module load: it is written into the shell before the bundle
 * runs and cannot change while the page is open. Absent when the application
 * configured nothing, which is the common case.
 */
declare global {
  interface Window {
    __NEST_ADMIN_THEME__?: { title?: string; logoUrl?: string }
  }
}

export const theme: { title?: string; logoUrl?: string } =
  (typeof window === 'undefined' ? undefined : window.__NEST_ADMIN_THEME__) ?? {}
