/**
 * The path the admin is mounted under.
 *
 * One string reaches three places that must agree, so it is normalised once,
 * here, rather than defended against separately in each of them:
 *
 *   - the router, which prefixes every controller route;
 *   - the served `index.html`, whose asset URLs are absolute;
 *   - the browser, which builds API URLs from it.
 *
 * A mismatch between any two of those is a blank admin with a 404 in the
 * console, which is a poor thing to debug.
 */

/** The mount path used when the application does not choose one. */
export const DEFAULT_MOUNT_PATH = '/admin'

/**
 * Canonical form: a single leading slash, no trailing slash, no empty segments.
 *
 * Accepts what people actually type - `admin`, `/admin`, `admin/`, `/admin/` -
 * and answers `/admin` for all of them.
 */
export function normaliseMountPath(path: string | undefined): string {
  if (path === undefined) return DEFAULT_MOUNT_PATH

  if (typeof path !== 'string') {
    throw new TypeError(`AdminModule \`path\` must be a string, received ${typeof path}.`)
  }

  const segments = path.split('/').filter((segment) => segment.length > 0)

  if (segments.length === 0) {
    // Mounting at the root would put `:model` on `/`, so the admin would answer
    // every unmatched request in the host application - including routes the
    // host defines later, which would then fail in a way that points nowhere
    // near this option.
    throw new Error(
      'AdminModule `path` cannot be empty or "/". The admin routes end in ' +
        '`:model`, so mounting them at the root would capture every unmatched ' +
        'request in the application. Choose a path such as "/admin".',
    )
  }

  for (const segment of segments) {
    // Unreserved URL characters only. That rules out route patterns (`:model`,
    // `*`) which would make the path un-buildable, and it also means the value
    // can be written into the served HTML without escaping - there is no
    // character left in it that could close a tag or a string.
    if (!/^[A-Za-z0-9._~-]+$/.test(segment)) {
      throw new Error(
        `AdminModule \`path\` segment "${segment}" is not a plain path segment. ` +
          'Use letters, digits, and any of . _ ~ - : the admin builds both URLs ' +
          'and HTML from this value, so it cannot contain patterns or markup.',
      )
    }
  }

  return `/${segments.join('/')}`
}
