/**
 * Turning arbitrary API values into something a person can read.
 *
 * The admin renders schemas it has never seen, so every cell may hold a null,
 * a boolean, a date string, an array or a nested object. Rendering those with
 * `String(value)` produces `[object Object]`, which is the classic tell of a
 * generic admin that was not finished.
 */
import type { FieldDescriptor } from '../api/types.js'

/** A short, single-line rendering suitable for a table cell. */
export function formatCell(field: FieldDescriptor, value: unknown): string {
  if (value === null || value === undefined) return '—'

  if (field.kind === 'boolean' || typeof value === 'boolean') return value ? 'Yes' : 'No'

  if (field.kind === 'datetime') return formatDate(value)

  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : `${value.length} item${value.length === 1 ? '' : 's'}`
  }

  if (typeof value === 'object') {
    // Never dump a nested object into a cell. The detail view shows it.
    return '{…}'
  }

  const text = String(value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

/** A fuller rendering for the detail view, where space is not scarce. */
export function formatDetail(field: FieldDescriptor, value: unknown): string {
  if (value === null || value === undefined) return '—'

  if (field.kind === 'boolean' || typeof value === 'boolean') return value ? 'Yes' : 'No'

  if (field.kind === 'datetime') return formatDate(value)

  if (Array.isArray(value) || typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      // Circular or otherwise unserialisable - say so rather than throwing
      // inside a render.
      return '[unserialisable value]'
    }
  }

  return String(value)
}

/**
 * Dates arrive as ISO strings over JSON.
 *
 * An unparseable value is shown verbatim rather than as "Invalid Date": if the
 * server sent something unexpected, seeing it is more useful than hiding it.
 */
function formatDate(value: unknown): string {
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleString()
}
