/**
 * What the import and export routes send and receive.
 *
 * Separate from the service so the interface can be typed against it without
 * importing anything that touches a database.
 */
import type { RecordData, RecordId } from '@nest-admin/core'

import type { ImportTarget } from './columns.js'

export type TransferFormat = 'csv' | 'json'

export interface ExportRequest {
  readonly format: TransferFormat
  /** Which columns, in this order. All of them, in schema order, when absent. */
  readonly columns?: readonly string[]
  /** `,` by default; `;` for an Excel that reads the European list separator. */
  readonly delimiter?: string
  /** The byte-order mark Excel needs to read UTF-8. On unless turned off. */
  readonly bom?: boolean
}

/** What a file turned out to contain, before anybody has decided anything. */
export interface ImportShape {
  /** The header, or the union of the keys in a JSON array. */
  readonly columns: readonly string[]
  readonly rows: number
  /** More rows than one import may carry. */
  readonly truncated: boolean
  /** The fields this import could write, and what each one accepts. */
  readonly targets: readonly ImportTarget[]
  /** Fields that can identify an existing record, for an import that updates. */
  readonly matchable: readonly string[]
  /** Field to column, guessed. A person corrects it before anything is planned. */
  readonly mapping: Readonly<Record<string, string>>
  /** The first few rows, so the mapping can be checked against real values. */
  readonly sample: readonly Readonly<Record<string, string>>[]
}

export interface ImportRequest {
  /** The file, as text. CSV or a JSON array of objects. */
  readonly body: string
  readonly mapping?: Readonly<Record<string, string>>
  /** The unique field that says a row already exists. Absent creates every row. */
  readonly matchBy?: string
}

export interface PlannedRow {
  /** The line of the file, counting the header - what a spreadsheet shows. */
  readonly line: number
  readonly action: 'create' | 'update' | 'refused'
  readonly id?: RecordId
  readonly values: RecordData
  readonly problems: readonly string[]
}

export interface ImportPlan {
  readonly matchBy: string | null
  readonly mapping: Readonly<Record<string, string>>
  readonly create: number
  readonly update: number
  readonly refused: number
  readonly rows: readonly PlannedRow[]
}

export interface ImportOutcome {
  readonly created: number
  readonly updated: number
  /**
   * Rows that did not make it, with the line to look at.
   *
   * Both halves are reported and nothing is rolled back, as with bulk delete:
   * there is no transaction across an import, and discarding nine hundred good
   * rows because one was bad helps nobody. The dry run is where a file gets
   * fixed; this is what is left after somebody chose to proceed anyway.
   */
  readonly failed: readonly { readonly line: number; readonly message: string }[]
}

/** How many planned rows the dry run sends back to be drawn. */
const PREVIEW_ROWS = 20

/**
 * The plan, small enough to send.
 *
 * The counts are of the whole file; the rows are a sample. **Every refused row
 * is included** regardless - the sample exists to show what an import will look
 * like, and the problems are the part somebody has to act on.
 */
export function previewOf(plan: ImportPlan): ImportPlan {
  const refused = plan.rows.filter((row) => row.action === 'refused')
  const rest = plan.rows.filter((row) => row.action !== 'refused').slice(0, PREVIEW_ROWS)

  return {
    ...plan,
    rows: [...refused.slice(0, MAX_PROBLEM_ROWS), ...rest].sort(
      (one, other) => one.line - other.line,
    ),
  }
}

/**
 * A ceiling on the refused rows sent back.
 *
 * A file mapped to the wrong column refuses every row, and a thousand copies of
 * the same sentence is not more informative than fifty.
 */
const MAX_PROBLEM_ROWS = 50
