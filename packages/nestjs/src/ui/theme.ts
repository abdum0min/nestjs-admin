/**
 * Branding the served page applies without a rebuild.
 *
 * The alternative is asking every application that wants its own colour to
 * fork the interface and run a bundler, which is the thing most admin
 * libraries make people do and the reason they stop using them.
 *
 * ## These values are written into HTML
 *
 * They come from the application's configuration rather than from a request, so
 * this is not a cross-site scripting boundary in the usual sense - but a
 * template that interpolates unchecked strings into a page is a mistake waiting
 * for the first configuration read from a database or an environment variable.
 * Each value is validated to a shape that cannot carry markup, and rejected at
 * startup if it does not fit.
 */

export interface AdminTheme {
  /**
   * Accent colour, as a CSS hex value - `#0b6e6e` or `#0b6`.
   *
   * Hex only. A full CSS colour grammar would mean parsing one, and a value
   * this small is not worth a parser; named colours and `rgb()` are excluded
   * for the same reason.
   */
  readonly brandColor?: string

  /** Page title and the name shown in the header. Plain text. */
  readonly title?: string

  /**
   * Logo shown beside the title.
   *
   * An `http(s)` URL or a `data:image/...` URI. Other schemes are refused:
   * `javascript:` in an image source is the obvious one, but the rule is a
   * whitelist rather than a blacklist so there is nothing to keep up with.
   */
  readonly logoUrl?: string
}

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Plain text with nothing that could open a tag, an entity or an attribute. */
const SAFE_TEXT = /^[^<>&"'`\\]{1,64}$/

const SAFE_URL = /^(?:https?:\/\/[^\s<>"'`\\]+|data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)$/

/**
 * Reject a theme that cannot be rendered safely.
 *
 * At startup, so a bad value is a boot failure rather than a broken page - and
 * so the message names the option rather than appearing as mangled HTML.
 */
export function assertUsableTheme(theme: AdminTheme | undefined): void {
  if (!theme) return

  if (theme.brandColor !== undefined && !HEX_COLOUR.test(theme.brandColor)) {
    throw new Error(
      `AdminModule \`theme.brandColor\` must be a hex colour such as "#0b6e6e", ` +
        `received ${JSON.stringify(theme.brandColor)}.`,
    )
  }

  if (theme.title !== undefined && !SAFE_TEXT.test(theme.title)) {
    throw new Error(
      `AdminModule \`theme.title\` must be plain text of at most 64 characters, ` +
        `without < > & " ' \` or backslashes. It is written into the served page.`,
    )
  }

  if (theme.logoUrl !== undefined && !SAFE_URL.test(theme.logoUrl)) {
    throw new Error(
      `AdminModule \`theme.logoUrl\` must be an http(s) URL or a data:image URI, ` +
        `received ${JSON.stringify(theme.logoUrl)}.`,
    )
  }
}

/**
 * The theme as markup to insert into the shell.
 *
 * A `<style>` block for the colour, so it reaches CSS without the interface
 * having to apply it, and a global for the parts the application reads. The
 * page title is not here: the shell already has one, and a second would leave
 * two in the document. `renderShell` replaces it instead.
 *
 * Everything here has been through `assertUsableTheme`.
 */
export function renderTheme(theme: AdminTheme | undefined): string {
  if (!theme || (!theme.brandColor && !theme.title && !theme.logoUrl)) return ''

  const style = theme.brandColor
    ? `<style>:root{--brand:${theme.brandColor};--accent:${theme.brandColor}}</style>`
    : ''

  const globals = JSON.stringify({
    ...(theme.title !== undefined ? { title: theme.title } : {}),
    ...(theme.logoUrl !== undefined ? { logoUrl: theme.logoUrl } : {}),
  })

  return `${style}<script>window.__NEST_ADMIN_THEME__ = ${globals}</script>`
}
