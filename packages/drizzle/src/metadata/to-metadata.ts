/**
 * A Drizzle schema, as `ModelMetadata`.
 *
 * The mapping is small because Core's vocabulary was chosen to be ORM-neutral,
 * and this is the first time that claim has been tested by something other than
 * Prisma. The places where the two ORMs disagree are noted where they occur;
 * none of them needed a change to Core.
 */
import { is, SQL } from 'drizzle-orm'
import type { FieldKind, FieldMetadata, ModelMetadata } from '@nest-admin/core'

import type { DrizzleColumn, DrizzleSchema, DrizzleTable } from '../schema/introspect.js'

/**
 * Drizzle's `dataType` to Core's `FieldKind`.
 *
 * `dataType` is the neutral one of the two type fields a column carries -
 * `columnType` is dialect-specific (`SQLiteText`, `PgVarchar`) and would make
 * this a table per dialect for no gain.
 *
 * `bigint` becomes `string`: it arrives as a `BigInt`, which does not survive
 * `JSON.stringify`, and the admin's transport is JSON. Calling it a number
 * would promise arithmetic that silently loses precision.
 */
const KINDS: Readonly<Record<string, FieldKind>> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  date: 'datetime',
  json: 'json',
  bigint: 'string',
  buffer: 'unknown',
  array: 'unknown',
  custom: 'unknown',
}

function kindOf(column: DrizzleColumn): FieldKind {
  // An enum in Drizzle is a text column with a list of allowed values, whatever
  // the dialect calls it underneath.
  if (column.enumValues !== undefined && column.enumValues.length > 0) return 'enum'
  return KINDS[column.dataType] ?? 'unknown'
}

/**
 * Whether the database or the ORM supplies this value.
 *
 * The same rule the Prisma adapter uses, stated in Drizzle's terms: a value
 * produced by *running something* is generated, a literal is a pre-fill for the
 * create form.
 *
 *   `.default('USER')`            literal   - a default value, offered in forms
 *   `` .default(sql`now()`) ``    generated - the database fills it in
 *   `.$defaultFn(...)`            generated - Drizzle fills it in
 *   `.$onUpdateFn(...)`           generated - the equivalent of `@updatedAt`
 *   `.primaryKey({autoIncrement})` generated
 */
function isGenerated(column: DrizzleColumn): boolean {
  return (
    column.autoIncrement === true ||
    typeof column.defaultFn === 'function' ||
    typeof column.onUpdateFn === 'function' ||
    is(column.default, SQL)
  )
}

function literalDefault(column: DrizzleColumn): unknown {
  if (!column.hasDefault || isGenerated(column)) return undefined
  return column.default
}

function toField(key: string, column: DrizzleColumn, primaryKey: readonly string[]): FieldMetadata {
  const isId = primaryKey.includes(key)
  const defaultValue = literalDefault(column)

  return {
    name: key,
    kind: kindOf(column),
    isId,
    isRequired: column.notNull,
    // A primary key is unique whether or not anyone said so.
    isUnique: column.isUnique || isId,
    // Drizzle has no list columns outside Postgres arrays, which arrive as
    // `dataType: 'array'` and are mapped to `unknown` above.
    isList: false,
    isGenerated: isGenerated(column),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(column.enumValues !== undefined && column.enumValues.length > 0
      ? { enumValues: [...column.enumValues] }
      : {}),
  }
}

function primaryKeyOf(
  entry: DrizzleTable,
  composite: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const declared = composite.get(entry.model)
  if (declared && declared.length > 0) return declared

  const inline: string[] = []
  for (const [key, column] of entry.columns) {
    if (column.primary) inline.push(key)
  }
  return inline
}

export interface ToMetadataInput {
  readonly schema: DrizzleSchema
  /** Composite keys, resolved by the caller because reading them needs the dialect. */
  readonly compositeKeys: ReadonlyMap<string, readonly string[]>
}

export function toModelMetadata(input: ToMetadataInput): readonly ModelMetadata[] {
  const { schema, compositeKeys } = input

  return schema.tables.map((entry) => {
    const primaryKey = primaryKeyOf(entry, compositeKeys)

    const columns: FieldMetadata[] = []
    for (const [key, column] of entry.columns) {
      columns.push(toField(key, column, primaryKey))
    }

    const relations: FieldMetadata[] = schema.relations
      .filter((relation) => relation.model === entry.model)
      .map((relation) => ({
        name: relation.field,
        kind: 'relation' as const,
        isId: false,
        // A to-one is required exactly when its foreign key is. A to-many never
        // is: a parent with no children is a parent.
        isRequired:
          relation.cardinality === 'one' && relation.from !== undefined
            ? (entry.columns.get(relation.from)?.notNull ?? false)
            : false,
        isUnique: false,
        isList: relation.cardinality === 'many',
        isGenerated: false,
        relation: {
          targetModel: relation.targetModel,
          cardinality: relation.cardinality,
          name: relation.name,
          ...(relation.from !== undefined ? { from: relation.from } : {}),
          ...(relation.to !== undefined ? { to: relation.to } : {}),
        },
      }))

    return { name: entry.model, primaryKey, fields: [...columns, ...relations] }
  })
}
