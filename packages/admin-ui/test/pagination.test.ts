/**
 * Which page numbers a pager draws.
 *
 * A pure function, so it is tested as one. The property that matters is not
 * which numbers appear but that the *count* of them does not change as you move
 * through the pages: a pager that grows and shrinks moves its own buttons under
 * the cursor, so the next click lands on a different number than the one it was
 * aimed at.
 */
import { describe, expect, it } from 'vitest'

import { pageSlots } from '../src/components/ui/pagination.js'

describe('the window of pages', () => {
  it('shows them all when they all fit', () => {
    expect(pageSlots(1, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps the first and the last within reach', () => {
    // The two destinations people actually want by name.
    const slots = pageSlots(20, 40)
    expect(slots[0]).toBe(1)
    expect(slots.at(-1)).toBe(40)
  })

  it('surrounds the current page', () => {
    expect(pageSlots(20, 40)).toEqual([1, 'gap', 19, 20, 21, 'gap', 40])
  })

  it('does not draw a gap that stands for one page', () => {
    // "1 … 3" is longer than "1 2 3" and says less.
    expect(pageSlots(4, 40)).toEqual([1, 2, 3, 4, 5, 'gap', 40])
    expect(pageSlots(4, 40)).not.toContain('gap-for-one')
  })

  it('keeps a steady width while moving through the middle', () => {
    // The property the whole shape exists for.
    const widths = new Set<number>()
    for (let page = 10; page <= 30; page++) widths.add(pageSlots(page, 40).length)
    expect(widths.size).toBe(1)
  })

  it('handles the ends without producing a shorter row', () => {
    expect(pageSlots(1, 40)).toHaveLength(pageSlots(40, 40).length)
  })

  it('answers for a single page', () => {
    expect(pageSlots(1, 1)).toEqual([1])
    expect(pageSlots(1, 0)).toEqual([1])
  })

  it('never repeats a page', () => {
    for (const [page, last] of [
      [1, 3],
      [2, 4],
      [3, 5],
      [1, 40],
      [2, 40],
      [39, 40],
      [40, 40],
    ] as const) {
      const numbers = pageSlots(page, last).filter((slot): slot is number => slot !== 'gap')
      expect(new Set(numbers).size, `page ${page} of ${last}`).toBe(numbers.length)
    }
  })

  it('stays in order', () => {
    const numbers = pageSlots(20, 40).filter((slot): slot is number => slot !== 'gap')
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
  })
})
