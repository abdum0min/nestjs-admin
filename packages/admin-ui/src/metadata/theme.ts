/**
 * Branding the server injected into the page.
 *
 * Read once, at module load: it is written into the shell before the bundle
 * runs and cannot change while the page is open. Absent when the application
 * configured nothing, which is the common case.
 */
declare global {
  interface Window {
    __NEST_ADMIN_THEME__?: {
      title?: string
      logoUrl?: string
      /** The logo for the sign-in screen, where a wordmark wants more room. */
      loginLogoUrl?: string
      /** A line under the sign-in form. */
      welcome?: string
      /** A line in the footer. */
      copyright?: string
      /** Which appearance to start from, before the viewer chooses. */
      appearance?: 'system' | 'light' | 'dark'
      /**
       * How much room the interface takes.
       *
       * Everything else the theme carries reaches CSS as a custom property and
       * needs nothing from the interface. This one is an attribute on the root
       * element, because the rules that read it are about padding on four
       * specific surfaces rather than about a value - see index.css.
       */
      density?: 'comfortable' | 'compact'
    }
  }
}

export const theme: NonNullable<Window['__NEST_ADMIN_THEME__']> =
  (typeof window === 'undefined' ? undefined : window.__NEST_ADMIN_THEME__) ?? {}
