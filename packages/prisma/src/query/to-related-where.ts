/**
 * Asking the target model for the records linked to one parent.
 *
 * A related list could be fetched from the parent - `user.posts()` - but then
 * pagination, sorting, filtering and relation loading would all have to be
 * reimplemented for that path. Asking the *target* model with an extra `where`
 * instead means a related list is an ordinary list that happens to be
 * constrained, and everything already built for lists applies to it unchanged.
 *
 * The constraint is expressed through the relation's other half, which is why
 * relation names matter:
 *
 *   User.posts  -> inverse is Post.author (to-one)   -> { author: { id: <parent> } }
 *   Post.tags   -> inverse is Tag.posts  (to-many)   -> { posts: { some: { id: <parent> } } }
 *
 * Both are Prisma relation filters on the target, so neither needs to know
 * whether a foreign key exists or where it lives.
 */
import {
  FieldNotFoundError,
  inverseRelationField,
  type ModelMetadata,
  type RecordId,
} from '@nest-admin/core'

import { coerceId } from './coerce-id.js'

/**
 * A `where` clause selecting the target records linked to `parentId`.
 *
 * `parentKey` is the parent's primary-key field, which the filter matches on.
 */
export function toRelatedWhere(
  parent: ModelMetadata,
  relationFieldName: string,
  parentId: RecordId,
  models: readonly ModelMetadata[],
): { target: ModelMetadata; where: Record<string, unknown> } {
  const field = parent.fields.find((candidate) => candidate.name === relationFieldName)

  if (!field?.relation) {
    throw new FieldNotFoundError(
      parent.name,
      relationFieldName,
      'Only a relation field can be listed this way.',
    )
  }

  if (field.relation.cardinality !== 'many') {
    throw new FieldNotFoundError(
      parent.name,
      relationFieldName,
      'This is a to-one relation. It arrives with the record itself.',
    )
  }

  const target = models.find((candidate) => candidate.name === field.relation?.targetModel)
  if (!target) {
    // The target is not part of this admin - excluded by configuration, or
    // hidden from this principal. Either way there is nothing to list.
    throw new FieldNotFoundError(
      parent.name,
      relationFieldName,
      `${field.relation.targetModel} is not available.`,
    )
  }

  const inverse = inverseRelationField(field, models)
  if (!inverse) {
    // Without the other half there is no way to express the constraint, and
    // returning every record of the target would be catastrophically wrong.
    throw new FieldNotFoundError(
      parent.name,
      relationFieldName,
      'The other half of this relation could not be resolved.',
    )
  }

  const [parentKey] = parent.primaryKey
  if (parentKey === undefined) {
    throw new FieldNotFoundError(
      parent.name,
      relationFieldName,
      `${parent.name} has no primary key.`,
    )
  }

  // Coerced here rather than by the caller, because this is the line that
  // turns an id into a Prisma argument. A string against an `Int @id` is
  // refused by Prisma with a message about its own argument types.
  const match = { [parentKey]: coerceId(parent, parentKey, parentId) }

  return {
    target,
    where: {
      [inverse.name]: inverse.relation?.cardinality === 'many' ? { some: match } : { is: match },
    },
  }
}
