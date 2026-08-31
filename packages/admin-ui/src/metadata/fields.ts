/**
 * How metadata decides what the UI does with a field.
 *
 * Every rule here reads the field descriptor the server sent. Nothing is keyed
 * on a model or field *name*, because the UI has to work for a schema it has
 * never seen - that is the whole premise. If a rule cannot be expressed from
 * metadata, it does not belong in the UI.
 */
import type { FieldDescriptor, FilterOperator, ModelDescriptor } from '../api/types.js'

/** Fields a user may type into. */
export function isEditable(field: FieldDescriptor): boolean {
  // `readOnly` covers generated values (cuid, now(), autoincrement, @updatedAt)
  // and anything the application marked read-only; the server refuses writes to
  // both, so an input would only produce a confusing 400. Relations and lists
  // are excluded for the same reason.
  //
  // `isGenerated` is still consulted, for a server that predates `readOnly`.
  const readOnly = field.readOnly ?? field.isGenerated
  return !readOnly && field.kind !== 'relation' && !field.isList
}

/** What to call a field: the application's label, or the column name. */
export function fieldLabel(field: FieldDescriptor): string {
  return field.label ?? field.name
}

/** Fields worth showing as table columns, in order, capped for readability. */
export function listColumns(model: ModelDescriptor, limit = 6): readonly FieldDescriptor[] {
  const scalars = model.fields.filter((field) => field.kind !== 'relation' && !field.isList)

  // The primary key first - it is what a person scans for and what every row
  // action needs - then the rest in schema order.
  const primary = scalars.filter((field) => field.isId)
  const rest = scalars.filter((field) => !field.isId)

  return [...primary, ...rest].slice(0, limit)
}

/** The field that identifies a record, if the model has a usable one. */
export function primaryKeyField(model: ModelDescriptor): FieldDescriptor | undefined {
  const [name] = model.primaryKey
  if (name === undefined) return undefined
  return model.fields.find((field) => field.name === name)
}

/** Read a record's id as the string the API's URLs expect. */
export function recordId(
  model: ModelDescriptor,
  record: Record<string, unknown>,
): string | undefined {
  const [name] = model.primaryKey
  if (name === undefined) return undefined
  const value = record[name]
  return value === null || value === undefined ? undefined : String(value)
}

/**
 * Operators offered for a field, drawn from the set the server accepts.
 *
 * Deliberately narrower than the full operator union per kind: offering
 * `contains` on a number would produce an INVALID_QUERY the user cannot act on,
 * because the server rejects string operators on non-string fields.
 */
export function operatorsFor(field: FieldDescriptor): readonly FilterOperator[] {
  switch (field.kind) {
    case 'string':
      return ['eq', 'ne', 'contains', 'startsWith', 'endsWith']
    case 'number':
    case 'datetime':
      return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte']
    case 'boolean':
      return ['eq']
    case 'enum':
      return ['eq', 'ne', 'in']
    default:
      // json, relation, unknown: the server has no meaningful comparison, so
      // the UI offers none rather than guessing.
      return []
  }
}

/** Fields a user may filter on. */
export function filterableFields(model: ModelDescriptor): readonly FieldDescriptor[] {
  return model.fields.filter((field) => operatorsFor(field).length > 0)
}

/**
 * Fields a user may sort by.
 *
 * The server rejects sorting on relation and list fields, so they are never
 * offered - the UI must not be able to build a query it knows will fail.
 */
export function sortableFields(model: ModelDescriptor): readonly FieldDescriptor[] {
  return model.fields.filter((field) => field.kind !== 'relation' && !field.isList)
}

/** The HTML input type that best matches a field kind. */
export function inputTypeFor(
  field: FieldDescriptor,
): 'text' | 'number' | 'checkbox' | 'datetime-local' {
  switch (field.kind) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'checkbox'
    case 'datetime':
      return 'datetime-local'
    default:
      return 'text'
  }
}

/**
 * Turn a form value back into what the API expects.
 *
 * The server validates types, but sending `"36"` where a number belongs would
 * earn a 500 rather than a useful message, so the conversion happens here.
 * `''` becomes `null` for optional fields and is dropped for required ones,
 * which lets a user clear a nullable column without inventing a "null" token.
 */
export function toRequestValue(field: FieldDescriptor, raw: string | boolean): unknown {
  if (field.kind === 'boolean') return Boolean(raw)

  const text = String(raw)
  if (text === '') return field.isRequired ? undefined : null

  if (field.kind === 'number') {
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : text
  }

  if (field.kind === 'datetime') {
    const parsed = new Date(text)
    return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString()
  }

  return text
}

/** Turn an API value into what a form control can display. */
export function toFormValue(field: FieldDescriptor, value: unknown): string | boolean {
  if (field.kind === 'boolean') return value === true

  if (value === null || value === undefined) return ''

  if (field.kind === 'datetime') {
    const parsed = new Date(String(value))
    if (Number.isNaN(parsed.getTime())) return ''
    // `datetime-local` wants `YYYY-MM-DDTHH:mm` with no zone or seconds.
    return parsed.toISOString().slice(0, 16)
  }

  return String(value)
}

/** What to call a model: the application's label, or the model name. */
export function modelLabel(model: ModelDescriptor): string {
  return model.label ?? model.name
}
