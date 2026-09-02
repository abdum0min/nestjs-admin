/**
 * Which field records when a row last changed.
 *
 * Used as a **version**: two people who opened the same record hold the same
 * value, and whoever saves second is holding a stale one. That is the whole
 * mechanism behind optimistic concurrency, and it needs no new column in any
 * schema that already has an `updatedAt`.
 *
 * ## The same guess `createdFieldFor` makes, and the same reason
 *
 * Metadata cannot tell an auto-updated timestamp from any other generated
 * date - Prisma reports `@default(now())` and `@updatedAt` identically,
 * because for *editing* they are the same thing: neither is asked of a person.
 * So this reads names, exactly as its sibling does.
 *
 * ## What it cannot check, and what is done about it
 *
 * A column called `updatedAt` that the schema does **not** update
 * automatically would produce a version that never changes - and a guard that
 * compares an unchanging value passes every time, silently. There is no way to
 * tell the two apart from metadata.
 *
 * So this does not try to hide it. It requires the column to be generated,
 * which is as close as metadata gets, and the module that uses it warns at
 * startup for every model where no version field could be found. A protection
 * nobody can see is not a protection - that lesson cost a deleted guard in the
 * release before this one.
 */
import type { FieldMetadata, ModelMetadata } from './model.js'

/**
 * Names that mean "when this row last changed", most conventional first.
 *
 * Snake case is included because a schema mapped onto an existing database
 * often keeps the column names it found there.
 */
const UPDATED = [
  'updatedAt',
  'updated_at',
  'updated',
  'modifiedAt',
  'modified_at',
  'lastModified',
  'last_modified',
]

function isDate(field: FieldMetadata): boolean {
  return field.kind === 'datetime' && !field.isList && !field.relation
}

/**
 * The field that records when a record of this model last changed, if the
 * model follows the convention.
 *
 * Unlike {@link createdFieldFor} there is no fallback to "the only generated
 * date": on a model with one, that date is far more likely to be `createdAt` -
 * which never changes - and a version that never changes is a guard that never
 * fires. Returning nothing is the honest answer, and the caller says so out
 * loud rather than pretending the model is protected.
 */
export function updatedFieldFor(model: ModelMetadata): string | undefined {
  const dates = model.fields.filter(isDate)

  for (const conventional of UPDATED) {
    const match = dates.find(
      (field) => field.name.toLowerCase() === conventional.toLowerCase() && field.isGenerated,
    )
    if (match) return match.name
  }

  return undefined
}
