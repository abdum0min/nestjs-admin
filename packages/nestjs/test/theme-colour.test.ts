/**
 * The arithmetic that keeps a brand colour readable.
 *
 * Asserted as a *guarantee* rather than as literal hex values: what matters is
 * that whatever an application configures, the text on it and the page behind
 * it both clear the contrast floor. Pinning the output to exact colours would
 * make every future adjustment to the palette a test failure without telling
 * anyone whether the result was still readable.
 *
 * The pairing this exists for is the one 0.7.0 found by hand: white on the
 * accent measured 2.52:1 in dark mode, on the one element that says where you
 * are.
 */
import { describe, expect, it } from 'vitest'

import { contrastRatio, isReadable, readableInk, visibleOn } from '../src/ui/colour.js'

/** Kept in step with the palette in packages/admin-ui/src/index.css. */
const PAGE = { light: '#f9fafb', dark: '#171a1f' }

/** A deliberately awkward spread: very dark, very light, saturated, muted. */
const BRANDS = [
  '#0b6e6e', // dark teal - the value this repository's own docs use
  '#1e3a8a', // navy: fine on white, invisible on near-black
  '#fde047', // bright yellow: fine on near-black, invisible on white
  '#7aa2f7', // mid blue: fine on both
  '#000000',
  '#ffffff',
  '#808080', // the hardest case - fails against both ends
  '#f0f', // three-digit form
]

describe('a colour that can be read on the brand', () => {
  it.each(BRANDS)('picks ink that clears the floor on %s', (brand) => {
    for (const page of ['light', 'dark'] as const) {
      const primary = visibleOn(brand, page)
      expect(isReadable(readableInk(primary), primary)).toBe(true)
    }
  })

  it('picks light ink for a dark colour and dark ink for a light one', () => {
    expect(contrastRatio(readableInk('#111827'), '#111827')).toBeGreaterThan(10)
    expect(readableInk('#111827')).not.toBe(readableInk('#fef3c7'))
  })
})

describe('a colour that can be seen on the page', () => {
  it.each(BRANDS)('lifts or lowers %s until it clears the floor', (brand) => {
    for (const page of ['light', 'dark'] as const) {
      expect(contrastRatio(visibleOn(brand, page), PAGE[page])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('leaves a colour alone when it already contrasts', () => {
    // The common case, and the reason most applications never see any of this.
    expect(visibleOn('#1e3a8a', 'light')).toBe('#1e3a8a')
    expect(visibleOn('#fde047', 'dark')).toBe('#fde047')
  })

  it('changes a colour that does not', () => {
    // Navy on near-black, and yellow on white. Both unreadable as configured.
    expect(visibleOn('#1e3a8a', 'dark')).not.toBe('#1e3a8a')
    expect(visibleOn('#fde047', 'light')).not.toBe('#fde047')
  })

  it('keeps the hue, which is the part people recognise', () => {
    // A brand is remembered as "our blue", not as a specific lightness. The
    // adjustment moves lightness; the ordering of the channels survives it.
    const dark = visibleOn('#1e3a8a', 'dark')
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(dark.slice(i, i + 2), 16))
    expect(b).toBeGreaterThan(g!)
    expect(g).toBeGreaterThan(r!)
  })

  it('gives up rather than looping forever on an impossible colour', () => {
    // Mid grey cannot reach 4.5:1 against a light page without becoming a
    // different colour entirely. It is moved as far as the budget allows and
    // returned; a wrong answer is better than a hang, and there is no right one.
    expect(() => visibleOn('#808080', 'light')).not.toThrow()
    expect(visibleOn('#808080', 'light')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
