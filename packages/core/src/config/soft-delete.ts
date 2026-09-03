/**
 * Deleting a record by marking it.
 *
 * Many real schemas carry a `deletedAt` column, and until this existed the
 * admin was actively wrong on every one of them: it listed marked rows as
 * though they were live, and its Delete button destroyed the row the schema
 * had gone to the trouble of arranging to keep. That is closer to a defect
 * than to a missing feature, which is why it is one line of configuration
 * rather than a subsystem:
 *
 *     models: { Post: { softDelete: 'deletedAt' } }
 *
 * ## What it is not
 *
 * Not an authorization boundary. A marked record is still readable at its own
 * URL - that is how a person restores one - and anybody who may list the model
 * may ask to see the marked rows. Hiding a record from a list is a statement
 * about what is current, not about who may see what; the thing that decides
 * who may see what is `resourceAuth`, and conflating the two would produce an
 * admin where the answer to "can they read it" depends on a column name.
 *
 * ## Why a date and not a flag
 *
 * A `deletedAt` says when, which a `deleted` boolean cannot, and every schema
 * that uses a boolean can add a date. Refusing the boolean **at startup** with
 * a message naming the limitation is better than accepting it and having two
 * meanings of "marked" - `false` and `null` - that no reader can keep straight.
 * A boolean can be supported later without changing anything written here.
 */
import type { ModelMetadata } from '../metadata/model.js'
import type { ModelOverrides } from './overrides.js'

/** The column that marks a record deleted, if this model has one. */
export function softDeleteFieldOf(
  overrides: ModelOverrides | undefined,
  model: string,
): string | undefined {
  return overrides?.[model]?.softDelete
}

/** Is this the column that marks a record deleted? */
export function isSoftDeleteField(
  overrides: ModelOverrides | undefined,
  model: string,
  field: string,
): boolean {
  return softDeleteFieldOf(overrides, model) === field
}

/**
 * Which views of a list a request may ask for.
 *
 * `live` is the default and is what every screen showed before this existed,
 * so a model that gains a `softDelete` does not change what anybody sees until
 * they ask for it.
 */
export type DeletedView = 'live' | 'deleted' | 'all'

/**
 * Reasons a declared `softDelete` column cannot do the job.
 *
 * Reported at startup rather than at the first delete, because the failure it
 * prevents is silent in the worst direction: a column the admin cannot write
 * `null` into would mark records that can never be restored, and one it cannot
 * write a date into would fall through to destroying the row - which is the
 * behaviour the option was added to stop.
 */
export function unusableSoftDeleteFields(
  models: readonly ModelMetadata[],
  overrides: ModelOverrides | undefined,
): readonly string[] {
  if (!overrides) return []

  const problems: string[] = []

  for (const [modelName, override] of Object.entries(overrides)) {
    const column = override.softDelete
    if (column === undefined) continue

    const model = models.find((candidate) => candidate.name === modelName)
    // A model the admin does not have is already reported, by name, as an
    // unknown override. Saying it twice in different words helps nobody.
    if (!model) continue

    const field = model.fields.find((candidate) => candidate.name === column)

    if (!field) {
      problems.push(`${modelName}.${column} is not a column on ${modelName}`)
      continue
    }

    if (field.kind !== 'datetime') {
      problems.push(
        `${modelName}.${column} is a ${field.kind} column, and soft delete needs a date - ` +
          `it records when, which a flag cannot`,
      )
      continue
    }

    if (field.isRequired) {
      problems.push(
        `${modelName}.${column} is required, so a live record has nowhere to put "not deleted"`,
      )
      continue
    }

    if (field.isGenerated) {
      problems.push(
        `${modelName}.${column} is produced by the database, so the admin cannot clear it to ` +
          `restore a record`,
      )
    }
  }

  return problems
}
