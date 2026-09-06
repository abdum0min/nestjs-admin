/**
 * Building records the database will accept.
 *
 * `values.ts` decides what one column holds. This decides which columns exist,
 * what a relation points at, and what order models have to be filled in - the
 * three things that turn a pile of plausible values into a row that inserts.
 *
 * Everything here is pure except `linkable`, which has to ask the database what
 * is already there. That split is deliberate: the interesting rules are the
 * ones about metadata, and those are testable by calling a function.
 */
import type { FieldMetadata, ModelMetadata } from '@nest-admin/core'

import { randomFrom, type Random } from './random.js'
import { valueFor } from './values.js'
import type { FakerLike } from './values.js'

/** A field the admin is allowed to write, and that a value can be invented for. */
export function writableFields(model: ModelMetadata): readonly FieldMetadata[] {
  return model.fields.filter(
    (field) =>
      !field.isGenerated &&
      !field.isList &&
      // A relation is written through its scalar key, which is a separate
      // field on the same model. Writing both would send the same fact twice.
      field.relation === undefined &&
      field.kind !== 'unknown',
  )
}

/** The scalar columns that carry a to-one relation, and where each points. */
export function foreignKeys(model: ModelMetadata): readonly ForeignKey[] {
  return model.fields
    .filter((field) => field.relation?.cardinality === 'one' && field.relation.from !== undefined)
    .map((field) => {
      const column = field.relation?.from as string
      const scalar = model.fields.find((candidate) => candidate.name === column)
      return {
        column,
        target: field.relation?.targetModel as string,
        // The scalar's own optionality is the truth. A relation marked required
        // on a schema whose column is nullable would make every generated row
        // need a parent it does not need.
        required: scalar?.isRequired === true,
        // A unique foreign key is a one-to-one: the parent can be taken once.
        // Reusing it is the difference between five profiles and two, and was
        // found by generating into a schema that had one.
        exclusive: scalar?.isUnique === true,
      }
    })
}

export interface ForeignKey {
  readonly column: string
  readonly target: string
  readonly required: boolean
  readonly exclusive: boolean
}

/**
 * How many rows this model can have at most, given who is left to point at.
 *
 * A one-to-one takes its parent out of circulation, so asking for twenty
 * profiles where five users exist can only ever produce five - and the other
 * fifteen would arrive as unique-constraint violations, which reads as a broken
 * generator rather than as a schema doing exactly what it says.
 *
 * `undefined` when nothing constrains it.
 */
export function exclusiveLimit(
  model: ModelMetadata,
  parents: ReadonlyMap<string, readonly unknown[]>,
): number | undefined {
  const limits = foreignKeys(model)
    .filter((key) => key.exclusive && key.required && key.target !== model.name)
    .map((key) => parents.get(key.target)?.length ?? 0)

  return limits.length === 0 ? undefined : Math.min(...limits)
}

/**
 * The order models have to be filled in.
 *
 * A Post needs an author, so Users come first. Kahn's algorithm over the
 * required to-one relations, with two deliberate softenings:
 *
 *   - **Optional relations are not edges.** A user whose manager is optional
 *     does not need another user to exist first; it can be linked afterwards,
 *     and treating it as an edge would make every self-relation a cycle.
 *   - **A cycle does not fail.** Two models that require each other cannot both
 *     be created, and refusing to generate anything at all because one corner
 *     of a schema is circular would be the wrong answer for the rest of it. The
 *     remaining models are appended in schema order and their creates fail
 *     individually, which is reported per row.
 */
export function fillOrder(models: readonly ModelMetadata[]): readonly string[] {
  const names = new Set(models.map((model) => model.name))
  const pending = new Map<string, Set<string>>()

  for (const model of models) {
    const parents = foreignKeys(model)
      .filter((key) => key.required && key.target !== model.name && names.has(key.target))
      .map((key) => key.target)
    pending.set(model.name, new Set(parents))
  }

  const ordered: string[] = []

  while (pending.size > 0) {
    const ready = [...pending.entries()]
      .filter(([, parents]) => parents.size === 0)
      .map(([name]) => name)

    if (ready.length === 0) {
      // Everything left is in a cycle. Append it and let the database say so.
      ordered.push(...pending.keys())
      break
    }

    for (const name of ready) {
      ordered.push(name)
      pending.delete(name)
    }
    for (const parents of pending.values()) {
      for (const name of ready) parents.delete(name)
    }
  }

  return ordered
}

export interface DraftContext {
  readonly model: ModelMetadata
  readonly index: number
  readonly random: Random
  readonly faker?: FakerLike | undefined
  /**
   * Ids that already exist for each model this one points at.
   *
   * Read once per run rather than per row: a hundred records would otherwise
   * be a hundred extra queries to answer a question whose answer does not
   * change.
   */
  readonly parents: ReadonlyMap<string, readonly unknown[]>
  /** Ids created for *this* model so far, so a self-relation has a target. */
  readonly siblings: readonly unknown[]
  /**
   * Parents already taken by a one-to-one, per column. Written to as rows are
   * drafted.
   *
   * The run's ledger, and the only mutable thing this function touches. A
   * `@unique` foreign key can be used once; without somewhere to record that,
   * every row picks at random from the same pool and most of them collide.
   */
  readonly claimed?: Map<string, Set<unknown>>
  /** Per-column overrides the application supplied, keyed `Model.field`. */
  readonly generators?: Readonly<Record<string, (index: number) => unknown>> | undefined
  /**
   * The widget each column was configured with.
   *
   * Passed in rather than read from the configuration here, so this file stays
   * a function of metadata and its arguments.
   */
  readonly widgetOf?: ((field: string) => string | undefined) | undefined
}

/** One record, ready for `adapter.create`. */
export function draft(context: DraftContext): Record<string, unknown> {
  const { model, index, random, faker, parents, siblings, generators, claimed, widgetOf } = context
  const record: Record<string, unknown> = {}

  const keys = new Map(foreignKeys(model).map((key) => [key.column, key]))

  for (const field of writableFields(model)) {
    const supplied = generators?.[`${model.name}.${field.name}`]
    if (supplied) {
      record[field.name] = supplied(index)
      continue
    }

    const key = keys.get(field.name)
    if (key) {
      // A self-relation points at a row this run already made. That is what
      // makes a generated tree - a reporting line, a category hierarchy - look
      // like a tree instead of a flat list of orphans.
      const pool = key.target === model.name ? siblings : (parents.get(key.target) ?? [])

      // A one-to-one hands out each parent once. Everything else may share.
      const taken = key.exclusive ? (claimed?.get(field.name) ?? new Set()) : undefined
      const available = taken ? pool.filter((id) => !taken.has(id)) : pool

      if (available.length === 0) {
        // Nothing to point at. Required is a problem the caller has to hear
        // about; optional is simply left empty, as it would be in real data.
        if (key.required) record[field.name] = undefined
        continue
      }

      // Not every optional link is taken. Real tables are not fully connected,
      // and a demo where every record has every relation set hides exactly the
      // empty states somebody needs to see working.
      if (!key.required && !random.chance(0.7)) continue

      const picked = random.pick(available)
      if (taken) {
        taken.add(picked)
        claimed?.set(field.name, taken)
      }

      record[field.name] = picked
      continue
    }

    // An optional column is sometimes left alone, so the interface's empty
    // states appear in a generated database rather than only in an empty one.
    if (!field.isRequired && field.defaultValue !== undefined && random.chance(0.3)) continue
    if (!field.isRequired && random.chance(0.15)) continue

    const value = valueFor({
      field,
      index,
      random,
      faker,
      record,
      widget: widgetOf?.(field.name),
    })
    if (value !== undefined) record[field.name] = value
  }

  return record
}

/** Which required parents this model has no rows to point at. */
export function missingParents(
  model: ModelMetadata,
  parents: ReadonlyMap<string, readonly unknown[]>,
): readonly string[] {
  return foreignKeys(model)
    .filter(
      (key) =>
        key.required && key.target !== model.name && (parents.get(key.target)?.length ?? 0) === 0,
    )
    .map((key) => key.target)
}

/**
 * A run's random source.
 *
 * Derived from the seed *and* the model name, so filling two models with one
 * seed does not give them the same sequence of values - which is visible
 * immediately when every Post's title matches a User's name.
 */
export function randomFor(seed: string, model: string): Random {
  return randomFrom(`${seed}:${model}`)
}
