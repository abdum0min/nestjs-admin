/**
 * Inferring what a value means from its own name.
 *
 * The rule is a guess, and the tests that matter are the ones about the guess
 * being wrong in a way somebody would notice: a word inside another word, a
 * category mistaken for a state, a qualifier that changes the answer.
 */
import { describe, expect, it } from 'vitest'

import { toneOf } from '../src/config/tone.js'

describe('the tone of a value', () => {
  it('recognises the states every schema has', () => {
    expect(toneOf('ACTIVE')).toBe('success')
    expect(toneOf('PAID')).toBe('success')
    expect(toneOf('PENDING')).toBe('warning')
    expect(toneOf('FAILED')).toBe('danger')
    expect(toneOf('CANCELLED')).toBe('danger')
  })

  /*
   * The one a substring match gets wrong, and it gets it exactly backwards:
   * `UNPAID` contains `paid`, so a naive `includes` calls an unpaid order
   * good news. Matching whole words is the whole reason the value is split.
   */
  it('does not read UNPAID as paid', () => {
    expect(toneOf('UNPAID')).toBe('warning')
    expect(toneOf('PAID')).toBe('success')
  })

  it('reads the four ways enum values are actually written', () => {
    expect(toneOf('IN_PROGRESS')).toBe('warning')
    expect(toneOf('in-progress')).toBe('warning')
    expect(toneOf('inProgress')).toBe('warning')
    expect(toneOf('In Progress')).toBe('warning')
  })

  /*
   * The leading word is the qualifier, and a qualified state is what the
   * qualifier says it is: a partial refund is something to look at, not a
   * completed refund.
   */
  it('lets the first recognised word win', () => {
    expect(toneOf('PARTIALLY_REFUNDED')).toBe('warning')
  })

  /*
   * Neutral is a real answer and the common one. Most enums are categories,
   * and colouring a size would be decoration that means nothing.
   */
  it('leaves categories alone', () => {
    expect(toneOf('SMALL')).toBe('neutral')
    expect(toneOf('MEDIUM')).toBe('neutral')
    expect(toneOf('LARGE')).toBe('neutral')
    expect(toneOf('EUR')).toBe('neutral')
  })

  it('answers neutral for anything it has never seen', () => {
    expect(toneOf('')).toBe('neutral')
    expect(toneOf('___')).toBe('neutral')
    expect(toneOf('Zxqv')).toBe('neutral')
  })
})
