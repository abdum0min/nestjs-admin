/**
 * A choice among a few, with every option on screen.
 *
 * ## Why a fieldset and native radios
 *
 * A radio group has a name of its own - the question - and its options are
 * answers to it. `<fieldset>` and `<legend>` are the only pair in HTML that
 * expresses that, and a screen reader reads the legend before each option
 * ("Status, Published, 2 of 4") without anything being wired up.
 *
 * Native `<input type="radio">` brings the arrow-key behaviour with it: within
 * one `name`, Up and Down move *and* select, and the group is a single tab
 * stop. That is the WAI-ARIA radio pattern, and it is the part everyone who
 * reimplements this on divs gets wrong.
 *
 * ## The name has to be unique on the page
 *
 * Two groups sharing a `name` are one group as far as the browser is
 * concerned, and choosing in either clears the other. The field's id is used,
 * which is already unique within the form.
 */
import { cn } from '../../lib/utils.js'

export function RadioGroup({
  name,
  value,
  options,
  labelledBy,
  describedBy,
  invalid = false,
  onChange,
}: {
  /** Unique on the page; two groups sharing one are a single group. */
  readonly name: string
  readonly value: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
  /** The id of the field's label, which becomes the group's name. */
  readonly labelledBy?: string
  readonly describedBy?: string
  readonly invalid?: boolean
  readonly onChange: (value: string) => void
}) {
  return (
    <fieldset
      className="flex flex-col gap-1.5"
      {...(labelledBy === undefined ? {} : { 'aria-labelledby': labelledBy })}
      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
      {...(invalid ? { 'aria-invalid': true } : {})}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex cursor-pointer items-center gap-2 text-sm',
            'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="border-input text-primary accent-primary size-4 shrink-0 cursor-pointer"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}
