/**
 * Reading a to-many relation from the parent's side.
 *
 * From `User`, both `posts` (one-to-many) and `Post.tags` (many-to-many) look
 * identical: a list of related records. What differs is where the link is
 * stored, and therefore what changing it means.
 *
 *   one-to-many   the child owns a column. Attaching a post to a user rewrites
 *                 `post.authorId`, which also *detaches it from whoever had it*.
 *                 Detaching means clearing that column, which is impossible if
 *                 it is required.
 *
 *   many-to-many  neither side owns a column; the link lives in a join table.
 *                 Attaching and detaching add and remove a row there and change
 *                 nothing about either record.
 *
 * An interface that offers the same buttons for both is lying about one of
 * them, so the difference is resolved here, once, from metadata both adapters
 * already produce.
 */
import type { FieldMetadata, ModelMetadata } from './model.js'

export type RelationShape = 'to-one' | 'one-to-many' | 'many-to-many'

/**
 * The field on the target model that is the other half of this relation.
 *
 * Matched by relation name, which is the only reliable pairing: two relations
 * between the same models (`author` and `reviewer`, both to `User`) are
 * otherwise indistinguishable. Returns `undefined` when the name is absent -
 * an adapter that does not supply one - or when the target is not in `models`.
 */
export function inverseRelationField(
  field: FieldMetadata,
  models: readonly ModelMetadata[],
): FieldMetadata | undefined {
  const relation = field.relation
  if (!relation?.name) return undefined

  const target = models.find((model) => model.name === relation.targetModel)
  if (!target) return undefined

  return target.fields.find(
    (candidate) => candidate.relation?.name === relation.name && candidate !== field,
  )
}

/**
 * What kind of relation this is, from the side the field is declared on.
 *
 * A to-many whose other half is also a list is a many-to-many. Without an
 * inverse to look at - no relation name, or a target outside this admin - a
 * to-many is reported as `one-to-many`, the more conservative answer: it is the
 * shape whose write operations have preconditions, so treating a many-to-many
 * as one costs a refused detach rather than a corrupted record.
 */
export function relationShape(
  field: FieldMetadata,
  models: readonly ModelMetadata[],
): RelationShape | undefined {
  const relation = field.relation
  if (!relation) return undefined
  if (relation.cardinality === 'one') return 'to-one'

  const inverse = inverseRelationField(field, models)
  return inverse?.relation?.cardinality === 'many' ? 'many-to-many' : 'one-to-many'
}

/**
 * Why a one-to-many relation cannot be detached, or `undefined` if it can.
 *
 * Detaching means clearing the child's foreign key, and a required column
 * cannot be cleared. The database would refuse it; saying so first is the
 * difference between "you cannot remove this here, delete the record instead"
 * and a constraint violation.
 */
export function detachBlockedReason(
  field: FieldMetadata,
  models: readonly ModelMetadata[],
): string | undefined {
  if (relationShape(field, models) !== 'one-to-many') return undefined

  const inverse = inverseRelationField(field, models)
  if (!inverse?.isRequired) return undefined

  const target = field.relation?.targetModel ?? 'the related model'
  return (
    `${target}.${inverse.name} is required, so a ${target} record cannot exist ` +
    `without one. Delete the record, or point it at something else, instead of ` +
    `detaching it.`
  )
}
