/**
 * A date field with a calendar, rather than the browser's own.
 *
 * `<input type="datetime-local">` works and is the reason it was used until
 * now. What it cannot do is look like the rest of the admin: the picker is
 * drawn by the operating system, in the system font, in the system's light
 * palette even when the page is dark - and on Firefox on the desktop, until
 * recently, not drawn at all.
 *
 * ## Typing still works
 *
 * The text box is not read-only and is not a display for the calendar. Someone
 * who knows the date types it; someone who does not opens the calendar. Both
 * write to the same value, and a half-typed date does not clear what was
 * already chosen - it simply is not a date yet.
 *
 * ## The value on the wire does not change
 *
 * `YYYY-MM-DDTHH:mm` for a datetime, `YYYY-MM-DD` for a date, exactly as
 * `toFormValue` produced and `toRequestValue` expects. This is a different way
 * of editing the same string, not a new format.
 */
import { CalendarDays } from 'lucide-react'
import { useState } from 'react'

import { Button } from './button.jsx'
import { Calendar } from './calendar.jsx'
import { Input } from './input.jsx'
import { Popover, PopoverContent, PopoverTrigger } from './popover.jsx'

/** `2026-08-31T14:30` -> a Date, or undefined when it is not one yet. */
function parse(value: string): Date | undefined {
  if (value === '') return undefined
  const parsed = new Date(value.length <= 10 ? `${value}T00:00` : value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/** Local time, not UTC: `toISOString` would shift the day for half the world. */
function format(date: Date, withTime: boolean): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return withTime ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day
}

export function DatePicker({
  value,
  onChange,
  withTime = true,
  id,
  required,
  disabled,
  ...aria
}: {
  readonly value: string
  readonly onChange: (next: string) => void
  /** A `datetime` field keeps its time; a plain date does not have one. */
  readonly withTime?: boolean
  readonly id?: string
  readonly required?: boolean
  readonly disabled?: boolean
} & Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'>) {
  const [open, setOpen] = useState(false)
  const selected = parse(value)

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        // Still the native control's own type, so a phone offers its keyboard
        // and the browser validates the shape for free.
        type={withTime ? 'datetime-local' : 'date'}
        value={value}
        required={required}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        {...aria}
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            aria-label={
              selected ? `Change date, currently ${format(selected, false)}` : 'Pick a date'
            }
          >
            <CalendarDays />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="p-2">
          <Calendar
            selected={selected}
            onSelect={(next) => {
              // Choosing a day keeps the time that was already there, because
              // a calendar has no opinion about it and clearing it would
              // silently move an appointment to midnight.
              if (withTime && selected) {
                next.setHours(selected.getHours(), selected.getMinutes(), 0, 0)
              }
              onChange(format(next, withTime))
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
