/**
 * How the resources are grouped in the navigation.
 *
 * A flat list of models is fine at eight and unusable at thirty, which is what
 * a real schema is. Grouping is the difference between a sidebar somebody
 * scans and one they search.
 *
 * ## Nothing disappears by being left out
 *
 * A model not named in any group is not hidden - it lands in a final group of
 * its own. Adding a model to the schema and finding it missing from the admin,
 * with nothing anywhere saying why, is worse than an untidy sidebar. Hiding a
 * model is what `resources` is for, and that decision is enforced rather than
 * cosmetic.
 *
 * ## It is resolved on the server
 *
 * The navigation in the metadata document is the *result*: groups already
 * filtered to the models this principal may see, empty ones already dropped,
 * the leftovers already collected. A role that cannot see `Order` does not
 * receive a "Sales" heading with nothing under it, and the interface needs no
 * rule of its own to avoid drawing one.
 */
import type { ModelIcon } from './overrides.js'

/** A heading with models under it. */
export interface NavigationGroup {
  /**
   * The heading. Omitted, the models are listed with no heading above them -
   * which is how to put a few loose resources at the top.
   */
  readonly heading?: string

  /** Model names, in the order they should appear under the heading. */
  readonly models: readonly string[]

  /** Start folded. The viewer's own choice, once made, wins over this. */
  readonly collapsed?: boolean
}

/** A link to somewhere else. */
export interface NavigationLink {
  readonly label: string

  /**
   * Where it goes.
   *
   * An absolute `http(s)` URL, a root-relative path, or a hash route inside
   * the admin. Anything else is refused at startup - `javascript:` in an href
   * is the reason, and the rule is a whitelist so there is nothing to keep up
   * with.
   */
  readonly href: string

  readonly icon?: ModelIcon

  /** Open in a new tab. Implied for an absolute URL, and settable either way. */
  readonly external?: boolean
}

/** A rule between groups. */
export interface NavigationDivider {
  readonly divider: true
}

export type NavigationEntry = NavigationGroup | NavigationLink | NavigationDivider

/**
 * The navigation, as the application declares it.
 *
 * Omitted entirely, the admin lists every model the way it always did.
 */
export type AdminNavigation = readonly NavigationEntry[]

export function isNavigationGroup(entry: NavigationEntry): entry is NavigationGroup {
  return 'models' in entry
}

export function isNavigationLink(entry: NavigationEntry): entry is NavigationLink {
  return 'href' in entry
}

/** An href that cannot execute. See {@link NavigationLink.href}. */
const SAFE_HREF = /^(?:https?:\/\/[^\s<>"'`\\]+|\/[^\s<>"'`\\]*|#\/[^\s<>"'`\\]*)$/

const SAFE_LABEL = /^[^<>&"'`\\]{1,64}$/

/**
 * Refuse a navigation that cannot be drawn, naming what is wrong.
 *
 * At startup, with the model names checked against the schema: a heading whose
 * models were all misspelled would otherwise be an empty group, and an empty
 * group looks exactly like a permission working correctly.
 */
export function unusableNavigation(
  navigation: AdminNavigation | undefined,
  models: readonly string[],
): readonly string[] {
  if (!navigation) return []

  const known = new Set(models)
  const seen = new Set<string>()
  const problems: string[] = []

  for (const [index, entry] of navigation.entries()) {
    const at = `navigation[${index}]`

    if ('divider' in entry) continue

    if (isNavigationLink(entry)) {
      if (!SAFE_LABEL.test(entry.label)) {
        problems.push(`${at}.label must be plain text of at most 64 characters.`)
      }
      if (!SAFE_HREF.test(entry.href)) {
        problems.push(
          `${at}.href must be an http(s) URL, a path starting with "/", or a hash route ` +
            `starting with "#/", received ${JSON.stringify(entry.href)}.`,
        )
      }
      continue
    }

    if (!isNavigationGroup(entry)) {
      problems.push(`${at} must be a group with \`models\`, a link with \`href\`, or a divider.`)
      continue
    }

    if (entry.heading !== undefined && !SAFE_LABEL.test(entry.heading)) {
      problems.push(`${at}.heading must be plain text of at most 64 characters.`)
    }

    for (const model of entry.models) {
      if (!known.has(model)) {
        problems.push(
          `${at} lists "${model}", which is not a model this admin has. ` +
            `Known models: ${models.join(', ')}.`,
        )
        continue
      }

      // Two headings claiming the same model would put it in the navigation
      // twice, and clicking either would highlight both.
      if (seen.has(model)) problems.push(`${at} lists "${model}", which an earlier group claims.`)
      seen.add(model)
    }
  }

  return problems
}
