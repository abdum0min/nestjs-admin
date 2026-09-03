/**
 * Reading a file column.
 *
 * The column holds a storage key, and four screens now have to turn one into
 * something a person can look at - the form, the table, the detail page and a
 * related table. They agreed on the rules by having the same twelve lines
 * copied into them, which is how two of those screens end up disagreeing in
 * six months. The rules live here instead.
 */
import { fileUrl } from '../api/client.js'

/** Anything that is already a location: leave it alone. */
const ABSOLUTE = /^(https?:)?\/\//i
const DATA = /^data:/i

/** A picture, judged by the only thing a key carries - its extension. */
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i

/**
 * Where a stored value can be read from.
 *
 * A value that already looks like a location is one: a store with its own URLs
 * - S3, R2, or a column that held a CDN address long before this admin existed
 * - and rewriting it would break every record saved before the store changed.
 */
export function fileHref(value: string): string {
  return ABSOLUTE.test(value) || DATA.test(value) || value.startsWith('/') ? value : fileUrl(value)
}

/**
 * What the person should see instead of the key.
 *
 * `2026/09/abc123-contract.pdf` is not a filename, and the random part is there
 * to make the key unguessable rather than to be read.
 */
export function fileNameOf(value: string): string {
  const path = value.split('?')[0] ?? value
  const last = path.split('/').at(-1) ?? path
  const dash = last.indexOf('-')
  return dash === -1 ? last : last.slice(dash + 1)
}

/**
 * Does this value look like a picture?
 *
 * Only consulted when the application did not say. A field declared
 * `widget: 'image'` is a picture whatever its values look like, and this is the
 * guess made for a `file` field that happens to hold one.
 */
export function looksLikeImage(value: string): boolean {
  return IMAGE.test(fileNameOf(value))
}
