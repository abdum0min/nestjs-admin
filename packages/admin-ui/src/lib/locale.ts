/**
 * The viewer's locale, and the formatters that follow it.
 *
 * `toLocaleString()` with no argument uses the runtime's default locale, which
 * in a browser is the browser's - but that is not the only place this code
 * runs. Under a test runner it is the operating system's, so a number rendered
 * on a Russian machine came out as "1 204" while the same component in a
 * browser set to English produced "1,204". Reading `navigator.language`
 * explicitly makes the choice the viewer's in every environment, which is what
 * was meant in the first place.
 */
export function viewerLocale(): string {
  return typeof navigator === 'undefined' ? 'en' : (navigator.language ?? 'en')
}

/** A count, grouped the way the viewer's locale groups digits. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(viewerLocale()).format(value)
}
