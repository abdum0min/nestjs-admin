/**
 * An id, in the type the schema declares.
 *
 * Ids reach the adapter from a URL, so they are always strings. Prisma refuses
 * a string for an `Int @id` - `Expected IntFilter or Int, provided String` -
 * rather than coercing it, which is the right call for a query builder and
 * leaves the conversion to whoever knows the schema. That is this package.
 *
 * ## Why this is its own module
 *
 * It used to be a private method on the adapter, called from the one place that
 * built a `where` clause by primary key. Two other places also turn an id into
 * a Prisma argument - the parent id in a related-list filter, and the target id
 * in a connect/disconnect - and neither of them could reach a private method,
 * so neither of them converted anything. Every relation route worked against a
 * string-keyed model and failed against an integer-keyed one.
 *
 * Being a module makes it reachable from all three, and makes the rule
 * testable on its own. Being called at each point where a value becomes a
 * Prisma argument - rather than once at the entrance - is deliberate: that is
 * where the mistake was made, so that is where the guard belongs.
 */
import { InvalidQueryError, type ModelMetadata, type RecordId } from '@nest-admin/core'

/**
 * Convert `id` to the type `model.fieldName` is declared as.
 *
 * Only numeric keys need anything done. A value that is already a number is
 * returned unchanged, so calling this twice is harmless - which matters,
 * because the paths below overlap.
 */
export function coerceId(model: ModelMetadata, fieldName: string, id: RecordId): RecordId {
  const field = model.fields.find((candidate) => candidate.name === fieldName)
  if (field?.kind !== 'number' || typeof id === 'number') return id

  const numeric = Number(id)
  if (!Number.isFinite(numeric)) {
    // Refused rather than passed through. Prisma would refuse it too, but with
    // a message about its own argument types rather than about the id someone
    // put in a URL.
    throw new InvalidQueryError(
      `Invalid id ${JSON.stringify(id)} for numeric primary key "${model.name}.${fieldName}".`,
    )
  }

  return numeric
}

/**
 * The same, against whatever `model` uses as its primary key.
 *
 * Returns the id untouched when the model has no single primary key: the
 * callers that care raise their own, better-worded error for that, and this
 * one should not pre-empt them.
 */
export function coercePrimaryKey(model: ModelMetadata, id: RecordId): RecordId {
  const [primaryKey, ...rest] = model.primaryKey
  if (primaryKey === undefined || rest.length > 0) return id
  return coerceId(model, primaryKey, id)
}
