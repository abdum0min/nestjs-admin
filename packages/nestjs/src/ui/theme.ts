/**
 * Branding the served page applies without a rebuild.
 *
 * The alternative is asking every application that wants its own colour to
 * fork the interface and run a bundler, which is the thing most admin
 * libraries make people do and the reason they stop using them.
 *
 * ## One value, or all of them
 *
 * `brandColor` is the shortcut: one hex, and the server derives a button fill,
 * its label colour and a readable link colour for both palettes. It is what
 * most applications want and it is one line.
 *
 * `colors` is the other end: every token the stylesheet reads, per palette.
 * The interface names roles rather than colours - `bg-card`, `text-muted-
 * foreground`, `border-input` - so overriding a role changes it everywhere at
 * once, and there is nothing left that a fork could reach and this cannot.
 *
 * The token list is **closed**, for the reason every closed list here is:
 * these names are interpolated into a stylesheet, and an open record would
 * mean writing an arbitrary property name into CSS. It also means a
 * misspelled token is a startup error rather than a setting that silently
 * does nothing.
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
import { readableInk, visibleOn } from './colour.js'

/**
 * The roles the stylesheet reads, as options.
 *
 * Each maps to the CSS custom property of the same name in kebab-case:
 * `mutedForeground` is `--muted-foreground`. The mapping is mechanical rather
 * than a table, but the *set* is not - see the file comment.
 *
 * Pairs are pairs on purpose. `destructive` fills a button and
 * `destructiveForeground` is what is written on it; setting one without the
 * other is how a red button ends up with red text.
 */
export interface AdminPalette {
  /** The page itself, and the ink on it. */
  readonly background?: string
  readonly foreground?: string

  /** Panels standing on the page: cards, tables, the record form. */
  readonly card?: string
  readonly cardForeground?: string

  /** Menus and dialogs, which sit above everything else. */
  readonly popover?: string
  readonly popoverForeground?: string

  /** The button fill, and the label on it. Set by `brandColor` when that is used. */
  readonly primary?: string
  readonly primaryForeground?: string

  /**
   * Link text.
   *
   * Separate from `primary` because a fill and a piece of text have different
   * contrast floors: a colour dark enough to carry white text can be too dark
   * to read as text itself. In light palettes they are usually the same value;
   * in dark ones they pull apart.
   */
  readonly link?: string

  readonly secondary?: string
  readonly secondaryForeground?: string

  /** Quiet surfaces, and the text that is deliberately less loud. */
  readonly muted?: string
  readonly mutedForeground?: string

  /** The pale wash a row takes on hover. Not the brand colour. */
  readonly accent?: string
  readonly accentForeground?: string

  readonly destructive?: string
  readonly destructiveForeground?: string
  readonly success?: string
  readonly successForeground?: string
  readonly warning?: string
  readonly warningForeground?: string

  /** Rules between rows. Quiet by design. */
  readonly border?: string
  /**
   * The edge of a text field.
   *
   * Deliberately louder than `border`: an input's boundary is the only thing
   * saying "you can type here", and WCAG asks 3:1 of it. The pale hairline
   * most component libraries use measures 1.4:1.
   */
  readonly input?: string
  /** The focus ring. Defaults to the primary colour. */
  readonly ring?: string

  readonly sidebar?: string
  readonly sidebarForeground?: string
  readonly sidebarBorder?: string
  readonly sidebarAccent?: string
  readonly sidebarAccentForeground?: string
}

export interface AdminFonts {
  /** The body stack, e.g. `"Inter", system-ui, sans-serif`. */
  readonly body?: string
  /** The monospace stack, for ids, code and JSON. */
  readonly code?: string
  /**
   * A stylesheet to load the faces from - a Google Fonts URL, usually.
   *
   * `https` only. It is a third-party request from a page that shows your
   * data, so it is opt-in and never implied by naming a family: a stack that
   * happens to name Inter falls back to the system font rather than quietly
   * reaching out to a CDN.
   */
  readonly stylesheet?: string
}

export interface AdminTheme {
  /**
   * Accent colour, as a CSS hex value - `#0b6e6e` or `#0b6`.
   *
   * Hex only. A full CSS colour grammar would mean parsing one, and a value
   * this small is not worth a parser; named colours and `rgb()` are excluded
   * for the same reason. `colors` takes the wider grammar, because a palette
   * copied out of a design system arrives in whatever notation it was written.
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

  /** Logo on the sign-in screen, where a wordmark usually wants more room. */
  readonly loginLogoUrl?: string

  /** The browser tab icon. Same rules as `logoUrl`. */
  readonly faviconUrl?: string

  /** A line under the sign-in form - "Acme staff only". Plain text. */
  readonly welcome?: string

  /** A line in the footer. Plain text. */
  readonly copyright?: string

  /**
   * Which appearance to start from, before anyone chooses.
   *
   * `'system'` follows the viewer's operating system and is the default. A
   * viewer's own choice, once made, wins over this and is remembered by their
   * browser - so this sets the first impression rather than a policy.
   */
  readonly appearance?: 'system' | 'light' | 'dark'

  /**
   * Corner radius, as a CSS length - `0`, `0.25rem`, `12px`.
   *
   * One value; the rest of the scale is derived from it, so a square theme is
   * `'0'` and nothing else has to be said.
   */
  readonly radius?: string

  /**
   * How much room the interface takes.
   *
   * `'compact'` tightens rows, form spacing and the navigation - the same
   * screen, more of it visible at once, which is what somebody who lives in a
   * table all day asks for.
   */
  readonly density?: 'comfortable' | 'compact'

  readonly fonts?: AdminFonts

  /** Every colour token, per palette. See {@link AdminPalette}. */
  readonly colors?: {
    readonly light?: AdminPalette
    readonly dark?: AdminPalette
  }

  /**
   * CSS appended after everything else. The escape hatch of last resort.
   *
   * The tokens above are the supported way to change how this looks, and they
   * reach further than they appear to: every component names a role, so one
   * token moves it everywhere. This exists for the case they do not cover,
   * because the alternative to an escape hatch is a fork.
   *
   * It is refused if it contains `<`, which is the only character that could
   * end the style element and start something else. CSS never needs one.
   *
   * What it targets is not a public API: class names come from Tailwind and
   * change when the interface does. Style the tokens where you can.
   */
  readonly customCss?: string
}

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * A colour in one of the notations a palette is actually written in.
 *
 * Hex, or one of the four functional forms - and inside the parentheses only
 * numbers, percentages, separators and the `none` keyword. Not a parser: a
 * shape check, wide enough for a palette copied out of a design system and
 * narrow enough that nothing which reaches the stylesheet can be anything but
 * a colour.
 */
const CSS_COLOUR = /^(?:oklch|oklab|rgba?|hsla?)\(\s*[0-9a-zA-Z.%,\s/+-]{1,64}\)$/

const isColour = (value: string): boolean => HEX_COLOUR.test(value) || CSS_COLOUR.test(value)

/** Plain text with nothing that could open a tag, an entity or an attribute. */
const SAFE_TEXT = /^[^<>&"'`\\]{1,64}$/

/** The same, with room for a sentence. Footers and welcome lines are longer. */
const SAFE_LINE = /^[^<>&"'`\\]{1,200}$/

const SAFE_URL = /^(?:https?:\/\/[^\s<>"'`\\]+|data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)$/

/** A stylesheet may only be fetched over https. See {@link AdminFonts.stylesheet}. */
const SAFE_STYLESHEET = /^https:\/\/[^\s<>"'`\\]+$/

/**
 * A font stack.
 *
 * Quotes are allowed, because `'Segoe UI'` needs them - so the check is about
 * what would escape the declaration instead: a brace, a semicolon, a comment,
 * or anything that could close the style element.
 */
const SAFE_FONT = /^[^<>{};\\]{1,200}$/
const COMMENT = '/*'

const SAFE_LENGTH = /^(?:0|\d{1,3}(?:\.\d{1,3})?(?:rem|em|px))$/

const APPEARANCES: ReadonlySet<string> = new Set(['system', 'light', 'dark'])
const DENSITIES: ReadonlySet<string> = new Set(['comfortable', 'compact'])

/** Every option this theme has. Anything else is a mistake, not a hint. */
const THEME_KEYS: ReadonlySet<string> = new Set([
  'brandColor',
  'title',
  'logoUrl',
  'loginLogoUrl',
  'faviconUrl',
  'welcome',
  'copyright',
  'appearance',
  'radius',
  'density',
  'fonts',
  'colors',
  'customCss',
])

const FONT_KEYS: ReadonlySet<string> = new Set(['body', 'code', 'stylesheet'])

/**
 * The palette, as the property names it produces.
 *
 * Written out rather than derived from a camel-case rule, so that the set of
 * properties this file can emit is visible in one place and cannot grow by
 * accident.
 */
const PALETTE: Readonly<Record<string, string>> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  link: '--link',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  destructiveForeground: '--destructive-foreground',
  success: '--success',
  successForeground: '--success-foreground',
  warning: '--warning',
  warningForeground: '--warning-foreground',
  border: '--border',
  input: '--input',
  ring: '--ring',
  sidebar: '--sidebar',
  sidebarForeground: '--sidebar-foreground',
  sidebarBorder: '--sidebar-border',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
}

const option = (name: string): string => `AdminModule \`theme.${name}\``

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
      `${option('brandColor')} must be a hex colour such as "#0b6e6e", ` +
        `received ${JSON.stringify(theme.brandColor)}.`,
    )
  }

  for (const name of ['title'] as const) {
    if (theme[name] !== undefined && !SAFE_TEXT.test(theme[name])) {
      throw new Error(
        `${option(name)} must be plain text of at most 64 characters, ` +
          `without < > & " ' \` or backslashes. It is written into the served page.`,
      )
    }
  }

  for (const name of ['welcome', 'copyright'] as const) {
    if (theme[name] !== undefined && !SAFE_LINE.test(theme[name])) {
      throw new Error(
        `${option(name)} must be plain text of at most 200 characters, ` +
          `without < > & " ' \` or backslashes. It is written into the served page.`,
      )
    }
  }

  for (const name of ['logoUrl', 'loginLogoUrl', 'faviconUrl'] as const) {
    if (theme[name] !== undefined && !SAFE_URL.test(theme[name])) {
      throw new Error(
        `${option(name)} must be an http(s) URL or a data:image URI, ` +
          `received ${JSON.stringify(theme[name])}.`,
      )
    }
  }

  if (theme.appearance !== undefined && !APPEARANCES.has(theme.appearance)) {
    throw new Error(
      `${option('appearance')} must be "system", "light" or "dark", ` +
        `received ${JSON.stringify(theme.appearance)}.`,
    )
  }

  if (theme.density !== undefined && !DENSITIES.has(theme.density)) {
    throw new Error(
      `${option('density')} must be "comfortable" or "compact", ` +
        `received ${JSON.stringify(theme.density)}.`,
    )
  }

  if (theme.radius !== undefined && !SAFE_LENGTH.test(theme.radius)) {
    throw new Error(
      `${option('radius')} must be a CSS length such as "0", "0.375rem" or "12px", ` +
        `received ${JSON.stringify(theme.radius)}.`,
    )
  }

  assertUsableFonts(theme.fonts)
  assertUsableColors(theme.colors)

  if (theme.customCss !== undefined && theme.customCss.includes('<')) {
    throw new Error(
      `${option('customCss')} must not contain "<". It is written inside a style ` +
        `element, and that is the one character that could end it.`,
    )
  }

  /*
   * An unknown key is a setting that silently does nothing.
   *
   * Every other part of the configuration refuses an unrecognised name at
   * startup - `resources`, `models`, and the field overrides all do. Theming
   * did not, and the cost of that showed up in this repository's own reference
   * consumer: it configured `accent` where the option is called `brandColor`,
   * the page stayed grey, and nothing anywhere said why.
   */
  const unknown = Object.keys(theme).filter((key) => !THEME_KEYS.has(key))
  if (unknown.length > 0) {
    throw new Error(
      `AdminModule \`theme\` has no option${unknown.length === 1 ? '' : 's'} called ` +
        `${unknown.join(', ')}. Known options: ${[...THEME_KEYS].join(', ')}.`,
    )
  }
}

function assertUsableFonts(fonts: AdminFonts | undefined): void {
  if (!fonts) return

  const unknown = Object.keys(fonts).filter((key) => !FONT_KEYS.has(key))
  if (unknown.length > 0) {
    throw new Error(
      `${option('fonts')} has no option called ${unknown.join(', ')}. ` +
        `Known options: ${[...FONT_KEYS].join(', ')}.`,
    )
  }

  for (const name of ['body', 'code'] as const) {
    const stack = fonts[name]
    if (stack === undefined) continue
    if (!SAFE_FONT.test(stack) || stack.includes(COMMENT)) {
      throw new Error(
        `${option(`fonts.${name}`)} must be a font stack such as ` +
          `"Inter, system-ui, sans-serif", without < > { } ; or a comment.`,
      )
    }
  }

  if (fonts.stylesheet !== undefined && !SAFE_STYLESHEET.test(fonts.stylesheet)) {
    throw new Error(
      `${option('fonts.stylesheet')} must be an https URL, ` +
        `received ${JSON.stringify(fonts.stylesheet)}.`,
    )
  }
}

function assertUsableColors(colors: AdminTheme['colors']): void {
  if (!colors) return

  const unknownPalettes = Object.keys(colors).filter((key) => key !== 'light' && key !== 'dark')
  if (unknownPalettes.length > 0) {
    throw new Error(
      `${option('colors')} has no palette called ${unknownPalettes.join(', ')}. ` +
        `It takes "light" and "dark".`,
    )
  }

  for (const palette of ['light', 'dark'] as const) {
    const entries = colors[palette]
    if (!entries) continue

    for (const [name, value] of Object.entries(entries)) {
      if (PALETTE[name] === undefined) {
        throw new Error(
          `${option(`colors.${palette}`)} has no token called "${name}". ` +
            `Known tokens: ${Object.keys(PALETTE).join(', ')}.`,
        )
      }

      if (typeof value !== 'string' || !isColour(value)) {
        throw new Error(
          `${option(`colors.${palette}.${name}`)} must be a colour - "#0b6e6e", ` +
            `"oklch(0.55 0.18 262)", "rgb(11 110 110)" - ` +
            `received ${JSON.stringify(value)}.`,
        )
      }
    }
  }
}

/**
 * The theme as markup to insert into the shell.
 *
 * A `<style>` block for everything CSS can carry, so it reaches the interface
 * without the interface having to apply it, and a global for the parts the
 * application reads - a logo is an `<img>`, not a variable. The page title is
 * not here: the shell already has one, and a second would leave two in the
 * document. `renderShell` replaces it instead.
 *
 * Everything here has been through `assertUsableTheme`.
 */
export function renderTheme(theme: AdminTheme | undefined): string {
  if (!theme || Object.keys(theme).length === 0) return ''

  const head: string[] = []

  // Before the style block, so a face is already being fetched while the rest
  // of the page parses.
  if (theme.fonts?.stylesheet !== undefined) {
    head.push(`<link rel="stylesheet" href="${theme.fonts.stylesheet}">`)
  }

  if (theme.faviconUrl !== undefined) {
    head.push(`<link rel="icon" href="${theme.faviconUrl}">`)
  }

  const css = stylesheet(theme)
  if (css !== '') head.push(`<style>${css}</style>`)

  const globals = JSON.stringify({
    ...(theme.title !== undefined ? { title: theme.title } : {}),
    ...(theme.logoUrl !== undefined ? { logoUrl: theme.logoUrl } : {}),
    ...(theme.loginLogoUrl !== undefined ? { loginLogoUrl: theme.loginLogoUrl } : {}),
    ...(theme.welcome !== undefined ? { welcome: theme.welcome } : {}),
    ...(theme.copyright !== undefined ? { copyright: theme.copyright } : {}),
    ...(theme.appearance !== undefined ? { appearance: theme.appearance } : {}),
    ...(theme.density !== undefined ? { density: theme.density } : {}),
  })

  if (globals !== '{}') head.push(`<script>window.__NEST_ADMIN_THEME__ = ${globals}</script>`)

  return head.join('')
}

/**
 * Everything the theme contributes to CSS, in the order it has to arrive.
 *
 * `brandColor` first, then `colors`: they can both write `--primary`, and the
 * more specific option is the one that should win. Both rules sit at the same
 * specificity, so the order in the file is the whole mechanism.
 *
 * `customCss` last, after everything this file generates, because that is what
 * an escape hatch means.
 */
function stylesheet(theme: AdminTheme): string {
  const light: string[] = []
  const dark: string[] = []

  if (theme.brandColor !== undefined) {
    light.push(brandRules(theme.brandColor, 'light'))
    dark.push(brandRules(theme.brandColor, 'dark'))
  }

  light.push(paletteRules(theme.colors?.light))
  dark.push(paletteRules(theme.colors?.dark))

  const root: string[] = []
  if (theme.radius !== undefined) root.push(`--radius:${theme.radius}`)
  if (theme.fonts?.body !== undefined) root.push(`--font-body:${theme.fonts.body}`)
  if (theme.fonts?.code !== undefined) root.push(`--font-code:${theme.fonts.code}`)

  const lightRule = [...root, ...light].filter((rule) => rule !== '').join(';')
  const darkRule = dark.filter((rule) => rule !== '').join(';')

  return [
    lightRule === '' ? '' : `:root{${lightRule}}`,
    // Scoped to `.dark`, the class the stylesheet already keys off. A class
    // beats `:root`, so the dark variant wins where it applies without either
    // rule needing `!important`.
    darkRule === '' ? '' : `.dark{${darkRule}}`,
    theme.customCss ?? '',
  ].join('')
}

function paletteRules(palette: AdminPalette | undefined): string {
  if (!palette) return ''

  return Object.entries(palette)
    .map(([name, value]) => `${PALETTE[name] as string}:${String(value)}`)
    .join(';')
}

/**
 * The brand colour, as rules for one palette.
 *
 * ## Why it sets `--primary` rather than `--accent`
 *
 * They are different roles in the token system: `--primary` is the colour of a
 * button, and `--accent` is the pale surface a row takes on hover. Writing a
 * brand colour into the second turns every hover into a solid block of it.
 *
 * ## Why one hex becomes three values
 *
 * A single colour cannot answer the questions the interface asks of it: what
 * text can be read on top of it, whether it can be seen against a light page
 * and against a dark one, and - separately - whether it can be *read* as link
 * text on each. A fill and a piece of text have different floors, so they get
 * different values. `colour.ts` answers all of it, and says there why the
 * server does this rather than the stylesheet.
 */
function brandRules(brand: string, page: 'light' | 'dark'): string {
  const fill = visibleOn(brand, page, 'fill')
  const text = visibleOn(brand, page, 'text')
  return `--primary:${fill};--primary-foreground:${readableInk(fill)};--link:${text}`
}
