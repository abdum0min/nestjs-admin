/**
 * The palette, measured.
 *
 * 0.7.0 found two contrast failures by hand and fixed them by hand. Writing the
 * design system rebuilt the palette from nothing, and a third appeared
 * immediately - `--warning` against its own text, at 4.05:1 - which is the
 * whole argument for this file. A palette is a set of numbers, and numbers can
 * be checked; the alternative is noticing later, or not at all.
 *
 * Reading the stylesheet rather than a duplicate table is deliberate. A test
 * that keeps its own copy of the colours passes forever after someone edits the
 * real ones.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

type Rgb = readonly [number, number, number]

/** oklch to sRGB, via Oklab. The stylesheet is authored in oklch; WCAG is defined in sRGB. */
function oklch(L: number, C: number, hue: number): Rgb {
  const h = (hue * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  const gamma = (c: number): number =>
    Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))

  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

function contrast(a: Rgb, b: Rgb): number {
  const luminance = (rgb: Rgb): number => {
    const [r, g, bl] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (lighter + 0.05) / (darker + 0.05)
}

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, '../src/index.css'), 'utf8')

function tokensIn(source: string): Record<string, Rgb> {
  const found: Record<string, Rgb> = {}
  for (const [, name, l, c, h] of source.matchAll(
    /--([a-z-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g,
  )) {
    found[name!] = oklch(Number(l), Number(c), Number(h))
  }
  // `--card-foreground: var(--foreground)` and friends.
  for (const [, alias, target] of source.matchAll(/--([a-z-]+):\s*var\(--([a-z-]+)\)/g)) {
    if (found[target!]) found[alias!] = found[target!]!
  }
  return found
}

const split = css.indexOf('.dark {')
const light = tokensIn(css.slice(css.indexOf(':root {'), split))
/** Dark redefines only some tokens; the rest are inherited from `:root`. */
const dark = { ...light, ...tokensIn(css.slice(split)) }

const PALETTES = { light, dark }

/**
 * Text on a surface. WCAG AA for body text.
 *
 * Every one of these is a place words are drawn on a coloured ground, which is
 * the pairing people actually have to read.
 */
const TEXT: readonly (readonly [string, string])[] = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['foreground', 'popover'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
]

/**
 * A coloured shape against the page. WCAG AA for non-text.
 *
 * A badge, a filled button, a focus ring: identifiable by its edge rather than
 * read, so 3:1 rather than 4.5:1 - but never nothing, because a focus ring
 * nobody can see is a keyboard user with nowhere to stand.
 */
const SURFACE: readonly (readonly [string, string])[] = [
  ['primary', 'background'],
  ['destructive', 'card'],
  ['success', 'card'],
  ['warning', 'card'],
  ['ring', 'background'],
  // The edge of a text field, which is what says "you can type here". WCAG
  // 1.4.11 is explicit that this one is a control boundary; a row rule in a
  // table is not, and is held to a different bar below.
  ['input', 'background'],
]

describe.each(Object.entries(PALETTES))('the %s palette', (name, palette) => {
  it('defines every token the checks below name', () => {
    // A typo in a token name would otherwise skip a pairing silently, and a
    // skipped pairing is exactly the one that ships broken.
    const named = new Set([...TEXT, ...SURFACE].flat())
    for (const token of named) expect(palette[token], `${name}: --${token}`).toBeDefined()
  })

  it.each(TEXT)('reads %s on %s at AA', (foreground, background) => {
    expect(contrast(palette[foreground]!, palette[background]!)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(SURFACE)('shows %s against %s', (shape, page) => {
    expect(contrast(palette[shape]!, palette[page]!)).toBeGreaterThanOrEqual(3)
  })
})

describe('the border', () => {
  it('is visible enough to separate rows without drawing attention', () => {
    // Deliberately not held to 3:1. A table's row rules are not a control
    // whose boundary carries meaning - the text does that - and a border at
    // 3:1 turns a quiet table into a grid of lines.
    for (const [name, palette] of Object.entries(PALETTES)) {
      const ratio = contrast(palette['border']!, palette['card']!)
      expect(ratio, `${name} border`).toBeGreaterThan(1.15)
    }
  })
})
