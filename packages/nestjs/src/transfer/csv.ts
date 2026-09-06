/**
 * CSV, both ways.
 *
 * Written here rather than taken from a package, for the same reason the PNG
 * encoder was: this is a bounded, fully specified format, and the dependency
 * would be permanent while the code is eighty lines.
 *
 * It follows RFC 4180 properly, which is the whole point. A CSV writer built on
 * `join(',')` corrupts data the first time somebody's product description
 * contains a comma, and a reader built on `split(',')` corrupts it at exactly
 * the same moment - silently, in a file somebody has already imported.
 *
 * ## What Excel needs, which the RFC does not mention
 *
 * A **byte-order mark**. Without it Excel reads a UTF-8 file as the local
 * codepage, so `ҳисобот` arrives as mojibake. It is three bytes and it is the
 * difference between a file that opens and a file somebody emails back.
 *
 * A **delimiter it recognises**. Excel splits on the list separator from the
 * operating system's regional settings, which in much of Europe is `;` rather
 * than `,`. A comma-separated file opens there as one column.
 *
 * ## Formula injection
 *
 * A cell beginning `=`, `+`, `-` or `@` is a **formula** to Excel and to Google
 * Sheets, and `=cmd|'/c calc'!A1` in a product name is a real attack on whoever
 * opens the export. Those values are prefixed with an apostrophe, which both
 * programs read as "this is text" and do not display.
 *
 * The reader strips that apostrophe back off, so a value survives an export and
 * a re-import unchanged. Anything that alters data on the way out has to know
 * how to put it back.
 */

/** What a cell can hold on the way out. Everything becomes text. */
export type CsvValue = string | number | boolean | Date | null | undefined

export interface CsvOptions {
  /** `,` by default; `;` for an Excel that reads the European list separator. */
  readonly delimiter?: string
  /** Prepend a byte-order mark, so Excel reads UTF-8 as UTF-8. */
  readonly bom?: boolean
}

const QUOTE = '"'
/** RFC 4180 says CRLF, and it is what Excel writes. */
const NEWLINE = '\r\n'
export const BOM = '﻿'

/** Characters that make Excel treat a cell as a formula rather than as text. */
const FORMULA = /^[=+\-@\t\r]/

function cell(value: CsvValue, delimiter: string): string {
  if (value === null || value === undefined) return ''

  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)

  // Neutralised before quoting, so the apostrophe ends up inside the quotes
  // where a reader will find it and take it off again.
  const safe = FORMULA.test(text) ? `'${text}` : text

  const mustQuote =
    safe.includes(delimiter) || safe.includes(QUOTE) || safe.includes('\n') || safe.includes('\r')

  return mustQuote ? `${QUOTE}${safe.replaceAll(QUOTE, QUOTE + QUOTE)}${QUOTE}` : safe
}

/** One row, with its line ending. Written a row at a time so an export streams. */
export function csvRow(values: readonly CsvValue[], options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ','
  return values.map((value) => cell(value, delimiter)).join(delimiter) + NEWLINE
}

export function csvHeader(columns: readonly string[], options: CsvOptions = {}): string {
  return (options.bom === false ? '' : BOM) + csvRow(columns, options)
}

/**
 * A whole CSV document, parsed.
 *
 * A character at a time rather than by splitting, because a field may contain
 * the delimiter, a newline, or a quote - and every one of those is legal inside
 * quotes. Splitting first and repairing afterwards is where CSV readers go
 * wrong.
 *
 * The delimiter is detected rather than asked for: a file that arrives from
 * Excel in Germany is semicolon-separated and nobody wants to be asked about
 * it.
 */
export function parseCsv(text: string): readonly (readonly string[])[] {
  const body = text.startsWith(BOM) ? text.slice(1) : text
  if (body.trim() === '') return []

  const delimiter = detectDelimiter(body)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0

  const endField = (): void => {
    // An apostrophe the writer added to defuse a formula comes back off, so a
    // value survives the round trip unchanged.
    row.push(field.startsWith("'") && FORMULA.test(field.slice(1)) ? field.slice(1) : field)
    field = ''
  }

  const endRow = (): void => {
    endField()
    // A trailing newline would otherwise produce a final row of one empty
    // field, which reads as a record with every column blank.
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  while (index < body.length) {
    const character = body[index] as string

    if (quoted) {
      if (character === QUOTE) {
        if (body[index + 1] === QUOTE) {
          field += QUOTE
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += character
      index += 1
      continue
    }

    if (character === QUOTE && field === '') {
      quoted = true
      index += 1
      continue
    }
    if (character === delimiter) {
      endField()
      index += 1
      continue
    }
    if (character === '\r' && body[index + 1] === '\n') {
      endRow()
      index += 2
      continue
    }
    if (character === '\n' || character === '\r') {
      endRow()
      index += 1
      continue
    }

    field += character
    index += 1
  }

  if (field !== '' || row.length > 0) endRow()
  return rows
}

/**
 * Which character separates the fields.
 *
 * Counted outside quotes on the header line only: a body row may legitimately
 * contain either character inside a quoted field, and the header is the line
 * whose shape is known.
 */
function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? ''

  let quoted = false
  const counts = { ',': 0, ';': 0, '\t': 0 }

  for (const character of header) {
    if (character === QUOTE) quoted = !quoted
    else if (!quoted && character in counts) counts[character as keyof typeof counts] += 1
  }

  const [best] = Object.entries(counts).sort(([, a], [, b]) => b - a)
  return best !== undefined && best[1] > 0 ? best[0] : ','
}
