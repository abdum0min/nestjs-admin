/**
 * Just enough colour arithmetic to keep a brand colour readable.
 *
 * ## Why the server does this at all
 *
 * An application sets one hex value. The interface has to put text on top of
 * it, and place it against both a light page and a dark one - three
 * relationships from one number, any of which can be unreadable.
 *
 * 0.7.0 found exactly that: the active navigation item was white on the accent,
 * which measured 2.52:1 in dark mode - on the one element whose job is to say
 * where you are. It was fixed by hand, for one pairing. Doing the arithmetic
 * here fixes the class: whatever colour arrives, the foreground chosen for it
 * is the one that contrasts, and a colour too dark to see on a dark page is
 * lightened until it can be.
 *
 * CSS cannot do this. `oklch(from …)` relative colours would come close, but
 * "pick whichever of black or white contrasts better" is a branch, and a
 * stylesheet has no branches. The server has the value and can simply look.
 *
 * ## The maths
 *
 * sRGB relative luminance and the contrast ratio, both from WCAG 2. Not a
 * perceptual colour space: the ratio is what the accessibility floor is
 * defined in, and matching the definition matters more here than matching
 * perception.
 */

/** WCAG AA for normal text: anything read as words on the page. */
const READABLE = 4.5

/**
 * WCAG AA for a shape rather than for words.
 *
 * A filled button is identified by the label on it, and that label carries its
 * own contrast - so the fill itself only has to be distinguishable from the
 * page, not readable against it.
 */
const VISIBLE = 3

/** `#rgb` or `#rrggbb` to channel values in 0..1. Assumes it has been validated. */
function channels(hex: string): [number, number, number] {
  const value =
    hex.length === 4
      ? hex
          .slice(1)
          .split('')
          .map((part) => part + part)
          .join('')
      : hex.slice(1)

  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  ]
}

function toHex([r, g, b]: readonly [number, number, number]): string {
  const part = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** WCAG relative luminance. */
function luminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: readonly [number, number, number], b: readonly [number, number, number]) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (lighter + 0.05) / (darker + 0.05)
}

/** The palette's own near-white and near-black, so the result matches the theme. */
const LIGHT_INK: readonly [number, number, number] = [0.985, 0.985, 0.99]
const DARK_INK: readonly [number, number, number] = [0.09, 0.1, 0.12]

/** Backgrounds the brand colour has to be visible against. Kept in step with index.css. */
const LIGHT_PAGE: readonly [number, number, number] = [0.976, 0.98, 0.984]
const DARK_PAGE: readonly [number, number, number] = [0.09, 0.1, 0.12]

/**
 * Text that can be read on this colour.
 *
 * Whichever of the palette's near-white and near-black contrasts better - not
 * whichever is prettier, and never a fixed choice. A mid-tone brand can fail
 * both, and then the better of two bad options is still the right answer and
 * the caller is told nothing, because there is nothing it could do about it.
 */
export function readableInk(hex: string): string {
  const brand = channels(hex)
  return contrast(brand, LIGHT_INK) >= contrast(brand, DARK_INK)
    ? toHex(LIGHT_INK)
    : toHex(DARK_INK)
}

/** Move a colour towards white (`1`) or black (`0`) by `amount`. */
function mix(
  rgb: readonly [number, number, number],
  towards: 0 | 1,
  amount: number,
): [number, number, number] {
  return rgb.map((channel) => channel + (towards - channel) * amount) as [number, number, number]
}

/**
 * The brand colour, adjusted until it can be read on this page.
 *
 * A navy that reads beautifully on white is nearly invisible on a near-black
 * page, and a bright yellow is invisible on white. Rather than refusing the
 * colour or shipping something unreadable, it is moved towards the page's
 * opposite in small steps until it clears the floor - keeping its hue, which
 * is what "our brand colour" means to whoever chose it.
 *
 * ## Two floors, because there are two jobs
 *
 * `role: 'fill'` is a button or a badge, where the label carries the contrast
 * and the fill only has to be a distinguishable shape - 3:1. `role: 'text'` is
 * a link on the page, which has to be read - 4.5:1.
 *
 * They were one token until an interface reviewer said the buttons looked
 * washed out in dark mode. They were right, and the measurement said so too:
 * holding a fill to the text floor forces it light enough that only near-black
 * text is readable on it, which is legible and looks faded. Separating them
 * lets a dark-mode button be a saturated fill with a light label, and lets link
 * text stay light enough to read.
 *
 * The cost is honest and worth stating: a very light or very dark brand comes
 * out shifted. That is preferable to shipping a colour the interface cannot
 * use, and the hue - the part people recognise - is what survives.
 *
 * Returns the colour unchanged when it already contrasts, which is the common
 * case and the reason most applications never see any of this.
 */
export function visibleOn(
  hex: string,
  page: 'light' | 'dark',
  role: 'fill' | 'text' = 'text',
): string {
  const background = page === 'dark' ? DARK_PAGE : LIGHT_PAGE
  const towards = page === 'dark' ? 1 : 0

  const floor = role === 'fill' ? VISIBLE : READABLE

  let colour = channels(hex)
  // Sixteen steps of 5%: enough to travel the whole range, small enough that a
  // colour that barely fails is barely changed.
  for (let step = 0; step < 16; step++) {
    if (contrast(colour, background) >= floor) break
    colour = mix(colour, towards, 0.05)
  }

  return toHex(colour)
}

/** Exported for tests: does this pairing clear the floor for body text? */
export function isReadable(foreground: string, background: string): boolean {
  return contrast(channels(foreground), channels(background)) >= READABLE
}

/** Exported for tests. */
export function contrastRatio(a: string, b: string): number {
  return contrast(channels(a), channels(b))
}
