/**
 * One value, drawn as what it means.
 *
 * ## Why this is its own module
 *
 * Two screens draw the same cell now - the list table, and a dashboard `list`
 * widget that names columns. A card that rendered its own approximation would
 * be a second answer to "how is an enum shown", and the two would drift: the
 * table would gain a badge and the card would keep printing `PENDING` in grey.
 *
 * ## Semantic emphasis
 *
 * Everything in a generated admin used to render at one weight - a status was
 * text, a flag was the word "Yes", a total was text. Nothing was emphasised, so
 * nothing was scannable, and reading a table meant reading it rather than
 * looking at it.
 *
 * Three kinds of value carry meaning the schema already knows and the eye can
 * use: an enum is a state, a boolean is a yes or a no, and a number is a
 * quantity. Each is drawn as such. Everything else stays plain, because
 * emphasis that is everywhere is emphasis nowhere.
 */
import { Check, Minus } from 'lucide-react'

import type { AdminRecord, FieldDescriptor, ModelDescriptor } from '../api/types.js'
import { href } from '../hooks/use-route.js'
import { formatCell } from '../metadata/format.js'
import { relationForForeignKey, relationLink } from '../metadata/relations.js'
import { fieldTone } from '../metadata/tone.js'
import { MediaCell } from './ui/media.jsx'
import { ValueBadge } from './ui/value-badge.jsx'

/**
 * Alignment, as the class that applies it.
 *
 * A map rather than an interpolated `text-${align}`: Tailwind scans source for
 * whole class names, and a name it never sees written is a name it never
 * generates. The interpolated version works in development and produces
 * unstyled cells in the built bundle.
 */
export const ALIGN: Readonly<Record<'left' | 'center' | 'right', string>> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

/**
 * One table cell.
 *
 * A foreign key is rendered as the related record's name, linking to it -
 * `authorId` says `cmtf50g…`, which is true and unusable. The raw value stays
 * available on the detail page.
 */
export function Cell({
  model,
  models,
  column,
  record,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly column: FieldDescriptor
  readonly record: AdminRecord
}) {
  const value = record[column.name]
  const relationField = relationForForeignKey(model, column.name)
  const link = relationField ? relationLink(relationField, models, record) : undefined

  // Before the relation check would be wrong - a foreign key is a key whatever
  // widget it was given - but after it, a file column is drawn rather than
  // printed. A column of `2026/09/abc123-ada.png` is the bug this closes.
  if (column.widget === 'image' || column.widget === 'file') {
    return <MediaCell field={column} value={value} />
  }

  if (link) {
    return (
      <a
        className="text-link underline-offset-4 hover:underline"
        href={href({ kind: 'detail', model: link.model, id: link.id })}
      >
        {link.label}
      </a>
    )
  }

  return <Value field={column} value={value} />
}

/**
 * A value with no relation and no file behind it.
 *
 * Exported because the dashboard's `list` widget draws the same three shapes
 * without a model to resolve relations against.
 */
export function Value({
  field,
  value,
}: {
  readonly field: FieldDescriptor
  readonly value: unknown
}) {
  const tone = fieldTone(field, value)
  if (tone !== undefined) return <ValueBadge tone={tone}>{String(value)}</ValueBadge>

  /*
   * A tick or a dash, not "Yes" and "No".
   *
   * Down a column the two words are the same length and the same weight, so
   * telling them apart means reading each one. Two different shapes do not.
   *
   * The word is still there for anything that is not looking at pixels - a
   * screen reader, a find-in-page - which is what `sr-only` is for. An icon
   * with a `title` would announce the same thing twice in some readers and not
   * at all in others.
   */
  if (field.kind === 'boolean' && typeof value === 'boolean') {
    return (
      <span className="inline-flex items-center">
        {value ? (
          <Check className="text-success size-4" aria-hidden="true" />
        ) : (
          <Minus className="text-muted-foreground size-4" aria-hidden="true" />
        )}
        <span className="sr-only">{value ? 'Yes' : 'No'}</span>
      </span>
    )
  }

  // Tabular figures, so digits are the same width and a column of them lines
  // up. Without it a proportional font makes 111 narrower than 999 and the
  // right edge of a right-aligned column wanders.
  if (field.kind === 'number' && typeof value === 'number') {
    return <span className="tabular-nums">{formatCell(field, value)}</span>
  }

  return <>{formatCell(field, value)}</>
}
