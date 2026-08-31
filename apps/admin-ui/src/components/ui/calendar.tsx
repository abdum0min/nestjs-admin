/**
 * A month, as a grid.
 *
 * ## Why this is written rather than installed
 *
 * The obvious choice is `react-day-picker`, and it was the first one made here.
 * Measuring the bundle afterwards showed what it costs: 156 KB of source, plus
 * `date-fns` at 129 KB and a timezone package at 24 KB, because it depends on
 * them. Three hundred kilobytes of source for one control, more than every
 * other dependency in this interface put together.
 *
 * What it buys is ranges, multiple months, disabled-day predicates,
 * localisation and a plugin surface. What is needed here is one date, one
 * month at a time. The grid below is a hundred lines, has no dependencies, and
 * is styled by the same tokens as everything around it rather than by a
 * `classNames` map that has to be kept in step with someone else's DOM.
 *
 * ## What it does not skimp on
 *
 * Month and weekday names come from `Intl.DateTimeFormat` in the viewer's own
 * locale, and the week starts on the day their locale starts on - hard-coding
 * Sunday is a thing that looks correct to whoever wrote it and wrong to most of
 * the world. Arrow keys move a day at a time and roll into the next month;
 * PageUp and PageDown move a month; Home and End go to the ends of the week.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '../../lib/utils.js'
import { Button } from './button.jsx'

const DAY = 86_400_000

/** Midnight local, so day arithmetic is not shifted by the clock. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Which weekday a week begins on here.
 *
 * `Intl.Locale.prototype.getWeekInfo` knows, and is not everywhere yet - so
 * Monday when it cannot be asked, which is what most of the world uses and what
 * ISO-8601 says. The previous default in most calendars is Sunday, which is
 * correct in fewer places than the code implying it suggests.
 */
function firstWeekday(locale: string): number {
  try {
    const info = (
      new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number } }
    ).getWeekInfo?.()
    // `getWeekInfo` numbers Monday 1 … Sunday 7; `getDay` numbers Sunday 0.
    return info ? info.firstDay % 7 : 1
  } catch {
    return 1
  }
}

export function Calendar({
  selected,
  onSelect,
  className,
}: {
  readonly selected?: Date
  readonly onSelect: (date: Date) => void
  readonly className?: string
}) {
  const locale = typeof navigator === 'undefined' ? 'en' : (navigator.language ?? 'en')
  const weekStart = firstWeekday(locale)
  const today = startOfDay(new Date())

  const [month, setMonth] = useState(() => {
    const from = selected ?? today
    return new Date(from.getFullYear(), from.getMonth(), 1)
  })

  /** The day the arrow keys are on. Not the selection: moving is not choosing. */
  const [focused, setFocused] = useState<Date>(() => selected ?? today)
  const grid = useRef<HTMLDivElement>(null)
  const shouldFocus = useRef(false)

  // Only after a key moved it, so opening the calendar does not steal focus
  // from the text box beside it.
  useEffect(() => {
    if (!shouldFocus.current) return
    shouldFocus.current = false
    grid.current?.querySelector<HTMLElement>('[data-focused="true"]')?.focus()
  }, [focused])

  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    month,
  )
  const weekdayName = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const dayLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'long' })

  // Six weeks always, so the popover does not change height between months.
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1)
  const lead = (firstOfMonth.getDay() - weekStart + 7) % 7
  const start = new Date(firstOfMonth.getTime() - lead * DAY)
  const days = Array.from({ length: 42 }, (_, index) =>
    startOfDay(new Date(start.getTime() + index * DAY)),
  )

  const move = (by: number): void => {
    const next = startOfDay(new Date(focused.getTime() + by * DAY))
    shouldFocus.current = true
    setFocused(next)
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) {
      setMonth(new Date(next.getFullYear(), next.getMonth(), 1))
    }
  }

  const shiftMonth = (by: number): void => {
    const next = new Date(month.getFullYear(), month.getMonth() + by, 1)
    setMonth(next)
    setFocused(new Date(next.getFullYear(), next.getMonth(), Math.min(focused.getDate(), 28)))
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    if (event.key in moves) {
      event.preventDefault()
      return move(moves[event.key]!)
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      return shiftMonth(event.key === 'PageUp' ? -1 : 1)
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const offset = (focused.getDay() - weekStart + 7) % 7
      return move(event.key === 'Home' ? -offset : 6 - offset)
    }
  }

  return (
    <div className={cn('w-64 text-sm', className)}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => shiftMonth(-1)}
        >
          <ChevronLeft />
        </Button>
        {/* Announced when it changes, so paging months is audible. */}
        <span className="font-medium" aria-live="polite">
          {monthName}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => shiftMonth(1)}
        >
          <ChevronRight />
        </Button>
      </div>

      <div className="text-muted-foreground grid grid-cols-7 gap-0.5 text-center text-xs">
        {Array.from({ length: 7 }, (_, index) => {
          const day = new Date(start.getTime() + index * DAY)
          return (
            <abbr
              key={index}
              className="py-1 no-underline"
              title={new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(day)}
            >
              {weekdayName.format(day)}
            </abbr>
          )
        })}
      </div>

      {/*
       * One tab stop for the whole grid.
       *
       * Forty-two buttons in the tab order would mean forty-two presses to get
       * past a calendar. The grid takes focus once and the arrow keys move
       * within it, which is the pattern every date control uses.
       */}
      <div
        ref={grid}
        role="grid"
        aria-label={monthName}
        className="mt-1 grid grid-cols-7 gap-0.5"
        onKeyDown={onKeyDown}
      >
        {days.map((day) => {
          const outside = day.getMonth() !== month.getMonth()
          const isSelected = selected !== undefined && sameDay(day, selected)
          const isFocused = sameDay(day, focused)

          return (
            <button
              key={day.getTime()}
              type="button"
              role="gridcell"
              data-focused={isFocused || undefined}
              tabIndex={isFocused ? 0 : -1}
              aria-selected={isSelected}
              aria-current={sameDay(day, today) ? 'date' : undefined}
              aria-label={dayLabel.format(day)}
              className={cn(
                'flex size-8 items-center justify-center rounded-md text-sm transition-colors',
                outside && 'text-muted-foreground/50',
                sameDay(day, today) && !isSelected && 'text-link font-semibold',
                isSelected
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )}
              onClick={() => {
                setFocused(day)
                onSelect(day)
              }}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
