/**
 * Which field records when a row appeared.
 *
 * A dashboard's most useful question is "how much of this arrived recently",
 * and answering it needs one column: the timestamp a record was created. Every
 * conventional schema has one and none of them declare it as such.
 *
 * ## Why this is a guess
 *
 * The metadata cannot tell a creation timestamp from any other generated date.
 * Prisma reports both `@default(now())` and `@updatedAt` the same way - the
 * adapter collapses them into `isGenerated`, because for *editing* they are the
 * same thing: neither is asked of a person. That is the right call for a form
 * and leaves nothing to distinguish them here.
 *
 * So this reads names, exactly as `displayFieldFor` does, and for the same
 * reason: the convention is near-universal and the alternative is a dashboard
 * that shows nothing until every application has annotated its schema.
 *
 * ## What it refuses to guess
 *
 * `updatedAt` and its variants are excluded rather than merely ranked lower. A
 * chart of "records updated per day" plotted under the heading "new records"
 * is worse than no chart: it is confidently wrong, and nothing about it looks
 * wrong. Where the convention is not followed, the answer is `undefined` and
 * the widget is simply not offered.
 */
import type { FieldMetadata, ModelMetadata } from './model.js'

/**
 * Names that mean "when this was created", most conventional first.
 *
 * Snake case is included because a schema mapped onto an existing database
 * often keeps the column names it found there.
 */
const CREATED = ['createdAt', 'created_at', 'created', 'createdOn', 'insertedAt', 'inserted_at']

/**
 * Names that must never be taken for it.
 *
 * Checked case-insensitively and by prefix, so `updatedAt`, `updated_at` and
 * `updateTime` are all excluded. Being wrong here is silent: a chart titled
 * "new this month" that is actually counting edits.
 */
const NOT_CREATED = ['updated', 'modified', 'deleted', 'archived', 'expires', 'expired']

function isDate(field: FieldMetadata): boolean {
  return field.kind === 'datetime' && !field.isList && !field.relation
}

function excluded(name: string): boolean {
  const lower = name.toLowerCase()
  return NOT_CREATED.some((word) => lower.startsWith(word))
}

/**
 * The field that records when a record of this model was created, if the model
 * follows the convention.
 *
 * Order of preference:
 *
 *  1. a conventional name, most conventional first;
 *  2. the only remaining generated date on the model - a model with exactly
 *     one date the database fills in has no ambiguity to resolve;
 *  3. nothing.
 *
 * The third is a real answer. A widget that cannot be built correctly is not
 * offered, which is a better outcome than one built on a column that means
 * something else.
 */
export function createdFieldFor(model: ModelMetadata): string | undefined {
  const dates = model.fields.filter(isDate)

  for (const conventional of CREATED) {
    const match = dates.find((field) => field.name.toLowerCase() === conventional.toLowerCase())
    if (match) return match.name
  }

  const generated = dates.filter((field) => field.isGenerated && !excluded(field.name))
  return generated.length === 1 ? generated[0]?.name : undefined
}
