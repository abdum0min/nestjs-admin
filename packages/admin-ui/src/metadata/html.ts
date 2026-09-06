/**
 * Stored HTML, read as text.
 *
 * A rich-text column holds markup, and there are places with one line to spare:
 * a table cell, a breadcrumb, the fallback while the editor's chunk is still
 * arriving. This is what to show in them.
 *
 * **It is not a sanitiser.** Nothing here makes markup safe to render - it
 * takes the markup away. Anything that displays stored HTML *as* HTML goes
 * through the editor's own parser instead, which is the one place in this
 * package that decides what survives; see `ui/rich-text.tsx`.
 *
 * Its own module rather than a helper inside a component, so the metadata layer
 * can use it without importing a React tree.
 */

/** The five entities a browser writes when it serialises text. */
const ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

export function textFromHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim()
}
