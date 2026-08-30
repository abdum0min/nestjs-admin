/**
 * Loading the readable side of a to-one relation.
 *
 * A record stores `authorId`. A person needs "Ada Lovelace". Resolving that in
 * the caller would mean one query per row - the classic N+1 - so it is done in
 * the same query, with an `include`.
 *
 * ## Only two columns are ever selected
 *
 * The `include` carries an explicit `select` of the target's primary key and
 * its display field, and nothing else. That is a security boundary, not an
 * optimisation: `include: { author: true }` would attach the *whole* related
 * record to every row, so a `User.passwordHash` would be published by the act
 * of listing `Post`. Naming the two columns means a relation can never widen
 * what a response contains.
 *
 * To-many relations are not loaded. They have no column on this side, they can
 * be unbounded, and one `include` per row would turn a list page into an
 * unpredictable amount of work. They arrive in 0.4.0, paginated and asked for
 * explicitly.
 */
import { displayFieldFor, type ModelMetadata } from '@nest-admin/core'

/** A Prisma `include` clause, or `undefined` when the model has no to-one relations. */
export type IncludeClause = Record<string, { select: Record<string, true> }>

/**
 * Build the `include` for every to-one relation the model owns.
 *
 * `models` is the full set, because the display field belongs to the *target*
 * model and can only be resolved by looking it up. A relation whose target is
 * missing from that set is skipped rather than guessed at: the target may have
 * been excluded from the admin by configuration, and inventing a column name
 * would produce a Prisma error blaming the schema.
 */
export function toIncludeClause(
  model: ModelMetadata,
  models: readonly ModelMetadata[],
): IncludeClause | undefined {
  const include: IncludeClause = {}

  for (const field of model.fields) {
    const relation = field.relation
    // `from` is what distinguishes the owning side from the other one. Without
    // it there is no column here, so there is nothing to resolve.
    if (!relation || relation.cardinality !== 'one' || relation.from === undefined) continue

    const target = models.find((candidate) => candidate.name === relation.targetModel)
    if (!target) continue

    const select: Record<string, true> = {}
    for (const key of target.primaryKey) select[key] = true
    select[displayFieldFor(target)] = true

    include[field.name] = { select }
  }

  return Object.keys(include).length > 0 ? include : undefined
}
