/**
 * The calendar, and the field it belongs to.
 *
 * Written here rather than installed - `react-day-picker` and the date library
 * it depends on came to 309 KB of source for one control - so it has to earn
 * that by working, not merely by being small. The keyboard behaviour is most of
 * what a date-picker library is actually for.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Calendar } from '../src/components/ui/calendar.jsx'
import { DatePicker } from '../src/components/ui/date-picker.jsx'

beforeEach(() => {
  vi.restoreAllMocks()
  /*
   * A fixed locale, so the assertions are not about the machine running them.
   *
   * The calendar takes its month names, its day labels and its first weekday
   * from `navigator.language`, which is the point of it - hard-coding Sunday
   * and "March 14, 2026" looks correct to whoever wrote it and wrong to most
   * of the world. en-GB is chosen deliberately over the default en-US: it
   * starts the week on Monday, so the week-start handling is exercised rather
   * than assumed.
   */
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB')
})

const grid = () => screen.getByRole('grid')
const day = (label: RegExp | string) => within(grid()).getByRole('gridcell', { name: label })

describe('the month', () => {
  it('opens on the month of the selected day', () => {
    render(<Calendar selected={new Date(2026, 2, 14)} onSelect={() => {}} />)
    expect(screen.getByRole('grid').getAttribute('aria-label')).toMatch(/March 2026/i)
  })

  it('always draws six weeks, so the popover does not change height', () => {
    // A month can span four, five or six calendar rows. Letting the grid follow
    // makes the panel jump as you page through it.
    render(<Calendar selected={new Date(2026, 1, 1)} onSelect={() => {}} />)
    expect(within(grid()).getAllByRole('gridcell')).toHaveLength(42)
  })

  it('pages by month, in both directions', () => {
    render(<Calendar selected={new Date(2026, 2, 14)} onSelect={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(grid().getAttribute('aria-label')).toMatch(/February 2026/i)

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(grid().getAttribute('aria-label')).toMatch(/April 2026/i)
  })

  it('marks the chosen day rather than only colouring it', () => {
    render(<Calendar selected={new Date(2026, 2, 14)} onSelect={() => {}} />)
    expect(day(/14 March 2026/).getAttribute('aria-selected')).toBe('true')
  })

  it('reports the day it was given', () => {
    const chosen = vi.fn()
    render(<Calendar selected={new Date(2026, 2, 14)} onSelect={chosen} />)

    fireEvent.click(day(/20 March 2026/))
    const given = chosen.mock.calls[0]?.[0] as Date
    expect(given.getDate()).toBe(20)
    expect(given.getMonth()).toBe(2)
  })
})

describe('the keyboard', () => {
  it('is one tab stop, not forty-two', () => {
    // Otherwise getting past a calendar costs six weeks of tab presses.
    render(<Calendar selected={new Date(2026, 2, 14)} onSelect={() => {}} />)

    const tabbable = within(grid())
      .getAllByRole('gridcell')
      .filter((cell) => cell.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
  })

  it('moves a day at a time with the arrows', () => {
    render(<Calendar selected={new Date(2026, 2, 14)} onSelect={() => {}} />)

    fireEvent.keyDown(grid(), { key: 'ArrowRight' })
    expect(day(/15 March 2026/).getAttribute('tabindex')).toBe('0')

    fireEvent.keyDown(grid(), { key: 'ArrowDown' })
    expect(day(/22 March 2026/).getAttribute('tabindex')).toBe('0')
  })

  it('rolls into the next month rather than stopping at the edge', () => {
    render(<Calendar selected={new Date(2026, 2, 31)} onSelect={() => {}} />)

    fireEvent.keyDown(grid(), { key: 'ArrowRight' })
    expect(grid().getAttribute('aria-label')).toMatch(/April 2026/i)
  })

  it('pages a month with PageUp and PageDown', () => {
    render(<Calendar selected={new Date(2026, 2, 14)} onSelect={() => {}} />)

    fireEvent.keyDown(grid(), { key: 'PageDown' })
    expect(grid().getAttribute('aria-label')).toMatch(/April 2026/i)

    fireEvent.keyDown(grid(), { key: 'PageUp' })
    expect(grid().getAttribute('aria-label')).toMatch(/March 2026/i)
  })

  it('moving is not choosing', () => {
    // Arrow keys explore; only Enter or a click commits. A calendar that fired
    // on every arrow would write six values on the way to the seventh.
    const chosen = vi.fn()
    render(<Calendar selected={new Date(2026, 2, 14)} onSelect={chosen} />)

    fireEvent.keyDown(grid(), { key: 'ArrowRight' })
    fireEvent.keyDown(grid(), { key: 'ArrowDown' })
    expect(chosen).not.toHaveBeenCalled()
  })
})

describe('the field it sits in', () => {
  it('still lets the date be typed', () => {
    // The text box is not a display for the calendar. Someone who knows the
    // date types it; someone who does not opens the calendar.
    const changed = vi.fn()
    render(<DatePicker value="" onChange={changed} />)

    fireEvent.change(screen.getByDisplayValue(''), { target: { value: '2026-03-14T09:30' } })
    expect(changed).toHaveBeenCalledWith('2026-03-14T09:30')
  })

  it('keeps the time when a day is chosen', () => {
    // A calendar has no opinion about the hour, and clearing it would silently
    // move an appointment to midnight.
    const changed = vi.fn()
    render(<DatePicker value="2026-03-14T09:30" onChange={changed} />)

    fireEvent.click(screen.getByRole('button', { name: /change date/i }))
    fireEvent.click(day(/20 March 2026/))

    expect(changed).toHaveBeenCalledWith('2026-03-20T09:30')
  })

  it('writes the local day, not the UTC one', () => {
    // `toISOString` would move the date by one for anyone east or west enough,
    // which is the classic off-by-a-day in every date field.
    const changed = vi.fn()
    render(<DatePicker value="2026-03-14T23:45" onChange={changed} />)

    fireEvent.click(screen.getByRole('button', { name: /change date/i }))
    fireEvent.click(day(/14 March 2026/))

    expect(changed).toHaveBeenCalledWith('2026-03-14T23:45')
  })
})
