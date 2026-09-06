/**
 * A cell of text, as a value the database will accept.
 *
 * Everything arrives here as a string, because a CSV has no types and a
 * spreadsheet is where most of these files are edited. What the string means is
 * decided by the schema, exactly as the query parser decides it for a filter.
 *
 * The rule throughout is that an unreadable cell **refuses its row** and says
 * why, rather than being coerced into something plausible. `Number('')` is `0`,
 * `Boolean('false')` is `true`, and `new Date('5')` is a day in 2001 - three
 * ways to import a file that reports complete success and contains the wrong
 * data, which is the failure this whole feature exists to avoid.
 */
import type { ImportTarget } from './columns.js'

export type Coerced =
  | { readonly kind: 'value'; readonly value: unknown }
  /** A relation whose cell may hold a key or a name; settled with one query. */
  | { readonly kind: 'lookup'; readonly text: string }
  | { readonly kind: 'problem'; readonly problem: string }

/** Words people type into a spreadsheet meaning yes and no. */
const TRUE = new Set(['true', 'yes', 'y', '1', 'on'])
const FALSE = new Set(['false', 'no', 'n', '0', 'off'])

export function coerce(target: ImportTarget, raw: string | undefined): Coerced {
  // Trimmed, because a leading space in a spreadsheet cell is almost always the
  // spreadsheet rather than the person - and because without it every emptiness
  // test below would be wrong for a cell containing one space.
  const text = (raw ?? '').trim()

  if (text === '') {
    if (target.required) {
      return { kind: 'problem', problem: 'this column is required and the cell is empty.' }
    }
    // A mapped column left blank clears the field. Unmapped columns are never
    // touched at all, which is the difference between "no value" and "no
    // opinion" - and the reason an import can update one column of a table.
    return { kind: 'value', value: null }
  }

  if (target.relation !== undefined) return { kind: 'lookup', text }

  switch (target.kind) {
    case 'number':
      return number(text)
    case 'boolean':
      return boolean(text)
    case 'datetime':
      return datetime(text)
    case 'enum':
      return member(text, target.enumValues ?? [])
    case 'json':
      return json(text)
    default:
      // Strings, and the columns the adapter could not map. A form sends those
      // as text too and the ORM decides - a Decimal accepts it, and anything
      // that does not fails with the database's own message.
      return { kind: 'value', value: text }
  }
}

function number(text: string): Coerced {
  // `Number` alone would take '0x10', '1e3' and '  12  '. A file that means
  // sixteen writes 16.
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) {
    return { kind: 'problem', problem: `"${text}" is not a number.` }
  }
  return { kind: 'value', value: Number(text) }
}

function boolean(text: string): Coerced {
  const word = text.toLowerCase()
  if (TRUE.has(word)) return { kind: 'value', value: true }
  if (FALSE.has(word)) return { kind: 'value', value: false }
  return { kind: 'problem', problem: `"${text}" is not true or false.` }
}

/**
 * A date, refusing anything a person would not recognise as one.
 *
 * `Date.parse` accepts far too much: `'5'` is a date, and so is `'Sat'`. A cell
 * has to look like a date - year first, or a slashed date, or a unix timestamp
 * of the right length - before it is read as one, so a mis-mapped column of
 * quantities fails loudly rather than importing as the year 2001.
 */
function datetime(text: string): Coerced {
  if (/^\d{10}$|^\d{13}$/.test(text)) {
    return { kind: 'value', value: new Date(Number(text) * (text.length === 10 ? 1000 : 1)) }
  }

  const shaped = /^\d{4}-\d{2}-\d{2}/.test(text) || /^\d{1,2}[/.]\d{1,2}[/.]\d{4}/.test(text)
  const parsed = shaped ? new Date(text) : new Date(Number.NaN)

  if (Number.isNaN(parsed.getTime())) {
    return {
      kind: 'problem',
      problem: `"${text}" is not a date. Write it as 2024-03-17, or 2024-03-17T09:00:00Z for a time.`,
    }
  }

  return { kind: 'value', value: parsed }
}

/**
 * One of the values the enum declares.
 *
 * Matched exactly first, then ignoring case, because `PUBLISHED` typed as
 * `published` is somebody being reasonable rather than somebody being wrong.
 * Anything else lists what the column accepts - a spelling this specific is not
 * worth guessing at.
 */
function member(text: string, values: readonly string[]): Coerced {
  if (values.includes(text)) return { kind: 'value', value: text }

  const loose = values.filter((value) => value.toLowerCase() === text.toLowerCase())
  if (loose.length === 1) return { kind: 'value', value: loose[0] }

  return {
    kind: 'problem',
    problem: `"${text}" is not one of ${values.join(', ')}.`,
  }
}

function json(text: string): Coerced {
  try {
    return { kind: 'value', value: JSON.parse(text) }
  } catch (cause) {
    return {
      kind: 'problem',
      problem: `this column holds JSON, and the cell is not valid JSON: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    }
  }
}
