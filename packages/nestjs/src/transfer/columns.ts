/**
 * What a model looks like as a table of columns, in both directions.
 *
 * Export and import have to agree about this or a file cannot make the round
 * trip, so the two answers are derived here rather than in each service.
 */
import {
  displayFieldFor,
  isReadOnly,
  type FieldKind,
  type FieldMetadata,
  type ModelMetadata,
  type ModelOverrides,
  type RecordData,
} from '@nest-admin/core'

import type { CsvValue } from './csv.js'

/** One column of an exported file. */
export interface ExportColumn {
  /** The header, and the key in a JSON object. */
  readonly name: string
  /** The property on the record it reads. */
  readonly source: string
  /**
   * Set on a relation's label column: the value is `record[source][nested]`.
   *
   * The adapters already fetch a to-one relation's key and display value with
   * the row - it is what the table shows - so a name costs no extra query.
   */
  readonly nested?: string
}

/**
 * Every column of a model, in schema order.
 *
 * A to-one relation contributes **two**: the foreign key, which is the truth
 * and is what an import can act on without ambiguity, and the label, which is
 * the half a person reading the file can use. Exporting only the key produces a
 * spreadsheet of opaque identifiers; exporting only the label produces one that
 * cannot be re-imported when two customers share a name.
 *
 * A to-many relation contributes none. It is a page of other records, not a
 * cell, and the honest place to export it is that model's own file.
 */
export function exportColumns(
  model: ModelMetadata,
  schema: readonly ModelMetadata[],
): readonly ExportColumn[] {
  const columns: ExportColumn[] = []

  for (const field of model.fields) {
    // Never returned on a read, by the same rule that keeps a password hash out
    // of every other response. An export is a read.
    if (field.writeOnly === true) continue

    if (field.kind === 'relation') {
      const relation = field.relation
      if (relation?.cardinality !== 'one' || relation.from === undefined) continue

      const target = schema.find((candidate) => candidate.name === relation.targetModel)
      if (target === undefined) continue

      columns.push({ name: field.name, source: field.name, nested: displayFieldFor(target) })
      continue
    }

    columns.push({ name: field.name, source: field.name })
  }

  return columns
}

/** Read one cell out of a record the admin has already projected. */
export function cellOf(record: RecordData, column: ExportColumn): CsvValue {
  const value = record[column.source]
  if (value === null || value === undefined) return null

  if (column.nested !== undefined) {
    const nested = (value as RecordData)[column.nested]
    return nested === null || nested === undefined ? null : scalar(nested)
  }

  return scalar(value)
}

/**
 * A database value as something a cell can hold.
 *
 * JSON columns and anything the adapter could not map become their JSON text,
 * which is what the import side parses back. A Date becomes ISO 8601 - the one
 * date format that survives a spreadsheet opened in another locale.
 */
function scalar(value: unknown): CsvValue {
  if (value instanceof Date) return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') return JSON.stringify(value)
  return value as CsvValue
}

/**
 * A field an import may write, and what a value for it has to satisfy.
 *
 * The relation half is the interesting one: `authorId` is an ordinary string
 * column to the schema, and only the relation that owns it knows the value in
 * that cell might be somebody's name.
 */
export interface ImportTarget {
  readonly field: string
  readonly kind: FieldKind
  readonly required: boolean
  readonly unique: boolean
  readonly enumValues?: readonly string[]
  /** Set when this scalar is a to-one relation's foreign key. */
  readonly relation?: {
    readonly model: string
    /** The column on the target that the key points at. */
    readonly to: string
    /** The column on the target a person would have typed instead. */
    readonly display: string
  }
}

/**
 * Which fields an import can write.
 *
 * Read-only ones are left out here rather than refused on the way in, so the
 * screen never offers a mapping that could only fail. That covers generated
 * columns, the soft-delete marker and anything the application marked
 * `readOnly` - the same rule the form obeys, decided by the same function.
 *
 * The relation *object* is not a target; its foreign key is, and already
 * appears as an ordinary scalar. Two mappings that write the same column would
 * be two ways to say the same thing, one of which silently wins.
 */
export function importTargets(
  model: ModelMetadata,
  schema: readonly ModelMetadata[],
  overrides: ModelOverrides | undefined,
): readonly ImportTarget[] {
  const keys = foreignKeys(model, schema)

  return model.fields
    .filter((field) => field.kind !== 'relation' && !field.isList)
    .filter((field) => !isReadOnly(overrides, model.name, field))
    .map((field) => {
      const relation = keys.get(field.name)

      return {
        field: field.name,
        kind: field.kind,
        // A column with a default is not something the file has to carry: the
        // database supplies it, exactly as it does for a form left blank.
        required: field.isRequired && field.defaultValue === undefined,
        unique: field.isUnique || model.primaryKey.includes(field.name),
        ...(field.enumValues === undefined ? {} : { enumValues: field.enumValues }),
        ...(relation === undefined ? {} : { relation }),
      }
    })
}

type Relation = NonNullable<ImportTarget['relation']>

function foreignKeys(
  model: ModelMetadata,
  schema: readonly ModelMetadata[],
): ReadonlyMap<string, Relation> {
  const keys = new Map<string, Relation>()

  for (const field of model.fields) {
    const relation = field.relation
    if (field.kind !== 'relation' || relation?.cardinality !== 'one') continue
    if (relation.from === undefined) continue

    const target = schema.find((candidate) => candidate.name === relation.targetModel)
    const to = relation.to ?? target?.primaryKey[0]
    if (target === undefined || to === undefined) continue

    keys.set(relation.from, { model: target.name, to, display: displayFieldFor(target) })
  }

  return keys
}

/**
 * Guess which column of a file belongs to which field.
 *
 * Exact name first, then ignoring case, underscores and spaces - so `Full Name`
 * finds `fullName` and `created_at` finds `createdAt`. Anything less obvious is
 * left unmapped for a person to decide, because a wrong guess here writes the
 * wrong column into every row of the file.
 *
 * A relation's label column matches its foreign key too: a file exported from
 * here has an `author` column beside `authorId`, and `author` is the one
 * somebody edited.
 */
export function suggestMapping(
  columns: readonly string[],
  targets: readonly ImportTarget[],
): Readonly<Record<string, string>> {
  const byNormal = new Map<string, string>()
  for (const column of columns) {
    const key = normalise(column)
    if (!byNormal.has(key)) byNormal.set(key, column)
  }

  const mapping: Record<string, string> = {}
  const taken = new Set<string>()

  for (const target of targets) {
    const exact = columns.includes(target.field) ? target.field : undefined
    const loose = byNormal.get(normalise(target.field))
    const named =
      target.relation === undefined ? undefined : byNormal.get(normalise(withoutId(target.field)))

    const found = [exact, loose, named].find(
      (candidate) => candidate !== undefined && !taken.has(candidate),
    )
    if (found === undefined) continue

    mapping[target.field] = found
    taken.add(found)
  }

  return mapping
}

/** `authorId` is written `author` in a file exported from here. */
function withoutId(field: string): string {
  return field.endsWith('Id') && field.length > 2 ? field.slice(0, -2) : field
}

function normalise(name: string): string {
  return name.toLowerCase().replaceAll(/[\s_-]+/g, '')
}

/**
 * Fields that can identify an existing record, for an import that updates.
 *
 * Read from the model rather than from the writable targets, because the
 * obvious one is the primary key and the primary key is generated - which makes
 * it read-only, and rightly so. Matching on a column is not writing it: the
 * value is used to find the row and is then written only if it happens to be
 * writable as well.
 */
export function matchableFields(model: ModelMetadata): readonly string[] {
  return model.fields
    .filter((field) => field.kind !== 'relation' && !field.isList)
    .filter((field) => field.isUnique || model.primaryKey.includes(field.name))
    .map((field) => field.name)
}

export function fieldOf(model: ModelMetadata, name: string): FieldMetadata | undefined {
  return model.fields.find((field) => field.name === name)
}
