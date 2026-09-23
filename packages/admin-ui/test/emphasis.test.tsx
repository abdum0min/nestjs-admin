/**
 * Semantic emphasis, in the interface.
 *
 * The release's claim is that the schema's own meaning becomes visible: a
 * status is a badge, a flag is a shape, a quantity is right-aligned. These
 * assert the rules behind that rather than the pixels - which value gets a
 * tone, which gets none, and who is allowed to overrule the guess.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { FieldDescriptor } from '../src/api/types.js'
import { Value } from '../src/components/Cell.jsx'
import { columnAlign, fieldTone, toneOf } from '../src/metadata/tone.js'

const field = (over: Partial<FieldDescriptor> & { name: string }): FieldDescriptor => ({
  kind: 'string',
  isId: false,
  isRequired: false,
  isUnique: false,
  isList: false,
  isGenerated: false,
  ...over,
})

const STATUS = field({
  name: 'status',
  kind: 'enum',
  enumValues: ['PAID', 'PENDING', 'FAILED', 'MEDIUM'],
})

describe('which values carry a tone', () => {
  it('reads a state from its own name', () => {
    expect(toneOf('PAID')).toBe('success')
    expect(toneOf('PENDING')).toBe('warning')
    expect(toneOf('CANCELLED')).toBe('danger')
  })

  // The substring trap, and the reason matching is on whole words.
  it('does not read UNPAID as paid', () => {
    expect(toneOf('UNPAID')).toBe('warning')
  })

  it('leaves a category alone', () => {
    expect(fieldTone(STATUS, 'MEDIUM')).toBe('neutral')
  })

  /*
   * Only enums. A free string has no fixed set of values, so a badge on one
   * would be a coloured box around arbitrary text.
   */
  it('badges nothing that is not an enum', () => {
    expect(fieldTone(field({ name: 'title' }), 'PAID')).toBeUndefined()
    expect(fieldTone(field({ name: 'n', kind: 'number' }), 12)).toBeUndefined()
  })

  it('lets the application correct the guess', () => {
    const corrected = { ...STATUS, badge: { PAID: 'danger' as const } }
    expect(fieldTone(corrected, 'PAID')).toBe('danger')
    // Only the ones it named; the rest are still inferred.
    expect(fieldTone(corrected, 'PENDING')).toBe('warning')
  })

  it('lets the application turn badges off entirely', () => {
    expect(fieldTone({ ...STATUS, badge: false }, 'PAID')).toBeUndefined()
  })
})

describe('how a column lines up', () => {
  it('sends numbers right and everything else left', () => {
    expect(columnAlign(field({ name: 'total', kind: 'number' }))).toBe('right')
    expect(columnAlign(field({ name: 'title' }))).toBe('left')
  })

  /*
   * A numeric id is a label, not a quantity. Right-aligning one puts the
   * least interesting digits where the eye lands.
   */
  it('leaves a numeric id alone', () => {
    expect(columnAlign(field({ name: 'id', kind: 'number', isId: true }))).toBe('left')
  })

  it('obeys the application over its own rule', () => {
    expect(columnAlign(field({ name: 'code', kind: 'number', align: 'left' }))).toBe('left')
    expect(columnAlign(field({ name: 'title', align: 'center' }))).toBe('center')
  })
})

describe('a drawn value', () => {
  it('draws an enum as a badge', () => {
    render(<Value field={STATUS} value="PAID" />)
    expect(screen.getByText('PAID')).toBeTruthy()
  })

  /*
   * Two words of the same length and weight have to be read; two shapes do
   * not. The word stays for anything not looking at pixels.
   */
  it('draws a boolean as a shape, with the word still readable', () => {
    const { container } = render(
      <Value field={field({ name: 'active', kind: 'boolean' })} value={true} />,
    )

    expect(within(container).getByText('Yes')).toBeTruthy()
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('draws a false boolean differently from a true one', () => {
    const yes = render(<Value field={field({ name: 'a', kind: 'boolean' })} value={true} />)
    const yesClass = yes.container.querySelector('svg')?.getAttribute('class')
    yes.unmount()

    const no = render(<Value field={field({ name: 'a', kind: 'boolean' })} value={false} />)
    expect(no.container.querySelector('svg')?.getAttribute('class')).not.toBe(yesClass)
  })

  it('leaves ordinary text alone', () => {
    render(<Value field={field({ name: 'title' })} value="The quiet harbour" />)
    expect(screen.getByText('The quiet harbour')).toBeTruthy()
  })
})
