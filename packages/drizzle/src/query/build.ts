/**
 * `ListQuery` into a Drizzle query.
 *
 * The rules enforced here are the ones the Prisma adapter enforces, and they
 * are enforced again rather than shared because they are about *this* ORM's
 * capabilities: which fields can be filtered, which operators a kind admits,
 * what a search box searches. Where the two adapters agree, they agree because
 * Core's contract says the same thing to both.
 *
 * ## Two places Drizzle needs work Prisma did for us
 *
 * **Case insensitivity.** Prisma has `mode: 'insensitive'`, on the providers
 * that support it. Drizzle has `ilike`, on Postgres only. Rather than branch per
 * dialect, both sides of the comparison go through `lower()`, which every
 * dialect this adapter supports has. It costs an index unless one is declared on
 * the expression - noted here because that is a real trade and not a free one.
 *
 * **`LIKE` metacharacters.** Prisma escapes `%` and `_` inside `contains`.
 * Building the pattern by hand means doing it here, or a search for `100%`
 * silently matches every row.
 */
import {
  FieldNotFoundError,
  InvalidQueryError,
  type FieldMetadata,
  type FilterRule,
  type ListQuery,
  type ModelMetadata,
  type SortRule,
} from '@nest-admin/core'
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm'

import type { DrizzleColumn, DrizzleTable } from '../schema/introspect.js'

/** Kept in step with `MAX_PER_PAGE` in the Prisma adapter and the UI's page-size list. */
export const DEFAULT_PER_PAGE = 25
export const MAX_PER_PAGE = 100

const STRING_ONLY = new Set(['contains', 'startsWith', 'endsWith'])
const COMPARISON = new Set(['gt', 'gte', 'lt', 'lte'])

type Purpose = 'filter' | 'sort'

/**
 * The field a rule may address, and the reason when it may not.
 *
 * Filtering by a to-one relation is answered by filtering its foreign key,
 * which is the same record with a name the caller is more likely to have. The
 * refusals mirror the Prisma adapter's, message for message, because they are
 * about what the admin promises rather than about either ORM.
 */
function queryable(model: ModelMetadata, fieldName: string, purpose: Purpose): FieldMetadata {
  const field = model.fields.find((candidate) => candidate.name === fieldName)
  if (!field) throw new FieldNotFoundError(model.name, fieldName)

  if (field.kind === 'relation') {
    const owned = field.relation?.from
    if (owned !== undefined && field.relation?.cardinality === 'one') {
      if (purpose === 'filter') return queryable(model, owned, purpose)
      throw new FieldNotFoundError(
        model.name,
        fieldName,
        `Sorting by a relation is not supported in this version. ` +
          `Sorting by "${owned}" would order by an opaque key rather than by ` +
          `anything readable.`,
      )
    }
    throw new FieldNotFoundError(
      model.name,
      fieldName,
      'Relation fields cannot be filtered or sorted in this version.',
    )
  }

  if (field.isList) {
    throw new FieldNotFoundError(
      model.name,
      fieldName,
      'List fields cannot be filtered or sorted in this version.',
    )
  }

  return field
}

function columnOf(entry: DrizzleTable, field: FieldMetadata): DrizzleColumn {
  const column = entry.columns.get(field.name)
  if (column === undefined) {
    // Metadata and schema came from the same object, so this is unreachable
    // short of a schema mutated after `getModels`.
    throw new FieldNotFoundError(entry.model, field.name)
  }
  return column
}

/** `%`, `_` and the escape character itself, so a search for "100%" means it. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`)
}

/** A case-insensitive LIKE that works on every dialect this adapter supports. */
function insensitiveLike(column: unknown, pattern: string): SQL {
  return sql`lower(${column}) LIKE lower(${pattern}) ESCAPE '\\'`
}

function condition(model: ModelMetadata, entry: DrizzleTable, rule: FilterRule): SQL {
  const field = queryable(model, rule.field, 'filter')
  const column = columnOf(entry, field)

  if (STRING_ONLY.has(rule.operator) && field.kind !== 'string' && field.kind !== 'enum') {
    throw new InvalidQueryError(
      `Operator "${rule.operator}" requires a string field, but ` +
        `"${model.name}.${field.name}" is of kind "${field.kind}".`,
    )
  }

  if (COMPARISON.has(rule.operator) && field.kind === 'boolean') {
    throw new InvalidQueryError(
      `Operator "${rule.operator}" cannot be applied to boolean field ` +
        `"${model.name}.${field.name}".`,
    )
  }

  const value = coerce(field, rule.value, model.name)

  switch (rule.operator) {
    case 'in': {
      if (!Array.isArray(rule.value)) {
        throw new InvalidQueryError(
          `Operator "in" requires an array value for "${model.name}.${field.name}".`,
        )
      }
      return inArray(
        column as never,
        rule.value.map((entryValue) => coerce(field, entryValue, model.name)),
      )
    }
    case 'eq':
      return eq(column as never, value)
    case 'ne':
      return ne(column as never, value)
    case 'gt':
      return gt(column as never, value)
    case 'gte':
      return gte(column as never, value)
    case 'lt':
      return lt(column as never, value)
    case 'lte':
      return lte(column as never, value)
    case 'contains':
      return insensitiveLike(column, `%${escapeLike(String(rule.value))}%`)
    case 'startsWith':
      return insensitiveLike(column, `${escapeLike(String(rule.value))}%`)
    case 'endsWith':
      return insensitiveLike(column, `%${escapeLike(String(rule.value))}`)
  }
}

/**
 * A value in the shape Drizzle's column mapper expects.
 *
 * Prisma accepts an ISO string for a `DateTime`; Drizzle's timestamp columns
 * expect a `Date` and will store the string as-is otherwise, which reads back
 * as an invalid date. The HTTP layer's coercion is type-directed but produces
 * JSON values, so the last step happens here - where the column is known.
 */
function coerce(field: FieldMetadata, value: unknown, model: string): unknown {
  if (value === null || value === undefined) return value

  if (field.kind === 'datetime' && !(value instanceof Date)) {
    const parsed = new Date(String(value))
    if (Number.isNaN(parsed.getTime())) {
      throw new InvalidQueryError(`"${value}" is not a date, for "${model}.${field.name}".`)
    }
    return parsed
  }

  return value
}

/**
 * What the search box searches.
 *
 * The same exclusions the Prisma adapter makes: generated columns, and foreign
 * keys. A foreign key is a string column holding an opaque id, so leaving it in
 * makes a one-letter search match nearly every row of any model that references
 * another.
 */
export function searchCondition(
  model: ModelMetadata,
  entry: DrizzleTable,
  term: string,
): SQL | undefined {
  const foreignKeys = new Set(
    model.fields.map((field) => field.relation?.from).filter((name) => name !== undefined),
  )

  const searchable = model.fields.filter(
    (field) =>
      (field.kind === 'string' || field.kind === 'enum') &&
      !field.isList &&
      !field.isGenerated &&
      !foreignKeys.has(field.name) &&
      entry.columns.has(field.name),
  )

  if (searchable.length === 0) return undefined

  const pattern = `%${escapeLike(term)}%`
  return or(...searchable.map((field) => insensitiveLike(columnOf(entry, field), pattern)))
}

export function buildWhere(
  model: ModelMetadata,
  entry: DrizzleTable,
  query: Pick<ListQuery, 'filters' | 'search'>,
): SQL | undefined {
  const conditions: SQL[] = []

  for (const rule of query.filters ?? []) {
    conditions.push(condition(model, entry, rule))
  }

  const term = query.search?.trim()
  if (term) {
    const search = searchCondition(model, entry, term)
    if (search) conditions.push(search)
  }

  if (conditions.length === 0) return undefined
  return conditions.length === 1 ? conditions[0] : and(...conditions)
}

export function buildOrderBy(
  model: ModelMetadata,
  entry: DrizzleTable,
  rules: readonly SortRule[] | undefined,
): readonly SQL[] {
  return (rules ?? []).map((rule) => {
    const field = queryable(model, rule.field, 'sort')
    const column = columnOf(entry, field)
    return (rule.direction === 'desc' ? desc(column as never) : asc(column as never)) as SQL
  })
}

export function resolvePagination(query: Pick<ListQuery, 'page' | 'perPage'>): {
  page: number
  perPage: number
  offset: number
  limit: number
} {
  const rawPage = query.page ?? 1
  const rawPerPage = query.perPage ?? DEFAULT_PER_PAGE

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1
  // Clamped rather than refused, matching the Prisma adapter: a page size above
  // the ceiling is a request for "as many as you will give me".
  const perPage =
    Number.isFinite(rawPerPage) && rawPerPage >= 1
      ? Math.min(Math.floor(rawPerPage), MAX_PER_PAGE)
      : DEFAULT_PER_PAGE

  return { page, perPage, offset: (page - 1) * perPage, limit: perPage }
}
