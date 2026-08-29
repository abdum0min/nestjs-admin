/**
 * Core `ListQuery` -> Prisma `findMany` arguments.
 *
 * Everything here is validated against model metadata before it reaches the
 * client. Field names arriving from an HTTP request eventually flow into this
 * module, so an unvalidated name would become an injection surface into the
 * query object. There is no raw SQL anywhere; all queries go through Prisma's
 * structured API.
 */
import {
  FieldNotFoundError,
  InvalidQueryError,
  type FieldMetadata,
  type FilterRule,
  type ListQuery,
  type ModelMetadata,
} from '@nest-admin/core'

export const DEFAULT_PER_PAGE = 25
export const MAX_PER_PAGE = 100

/** Operators that only make sense on string fields. */
const STRING_ONLY_OPERATORS = new Set(['contains', 'startsWith', 'endsWith'])

/** Operators that require an ordered (numeric, date, or string) field. */
const COMPARISON_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte'])

export interface PrismaFindManyArgs {
  where?: Record<string, unknown>
  orderBy?: Array<Record<string, 'asc' | 'desc'>>
  skip?: number
  take?: number
}

/**
 * A field usable in a filter, sort, or write.
 *
 * Relations and list fields are excluded: the MVP has no nested relation
 * querying, and pretending otherwise would produce Prisma errors that surface
 * to users as opaque failures.
 */
function findQueryableField(model: ModelMetadata, fieldName: string): FieldMetadata {
  const field = model.fields.find((candidate) => candidate.name === fieldName)
  if (!field) {
    throw new FieldNotFoundError(model.name, fieldName)
  }
  if (field.kind === 'relation') {
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

function toPrismaCondition(model: ModelMetadata, rule: FilterRule): Record<string, unknown> {
  const field = findQueryableField(model, rule.field)

  if (STRING_ONLY_OPERATORS.has(rule.operator) && field.kind !== 'string') {
    throw new InvalidQueryError(
      `Operator "${rule.operator}" requires a string field, but ` +
        `"${model.name}.${field.name}" is of kind "${field.kind}".`,
    )
  }

  if (COMPARISON_OPERATORS.has(rule.operator) && field.kind === 'boolean') {
    throw new InvalidQueryError(
      `Operator "${rule.operator}" cannot be applied to boolean field ` +
        `"${model.name}.${field.name}".`,
    )
  }

  if (rule.operator === 'in') {
    if (!Array.isArray(rule.value)) {
      throw new InvalidQueryError(
        `Operator "in" requires an array value for "${model.name}.${field.name}".`,
      )
    }
    return { [field.name]: { in: rule.value } }
  }

  if (rule.operator === 'eq') return { [field.name]: { equals: rule.value } }
  if (rule.operator === 'ne') return { [field.name]: { not: rule.value } }

  return { [field.name]: { [rule.operator]: rule.value } }
}

/**
 * Free-text search: `contains` across the model's meaningful string fields.
 *
 * Generated string fields are excluded. A `cuid()` or `uuid()` primary key is
 * an opaque machine value, and including it makes single-letter searches match
 * essentially at random - searching "e" returns any record whose id happens to
 * contain an "e". Looking a record up by its id is an exact-match concern, so
 * it belongs in a filter (`{ field: 'id', operator: 'eq' }`), not in free text.
 *
 * Case sensitivity is deliberately left to the database. Prisma's
 * `mode: 'insensitive'` is PostgreSQL-only and throws on SQLite, so applying it
 * would make behaviour depend on the provider in a way the MVP has not tested.
 * Documented as a known limitation.
 */
function toSearchCondition(
  model: ModelMetadata,
  term: string,
): Record<string, unknown> | undefined {
  const stringFields = model.fields.filter(
    (field) => field.kind === 'string' && !field.isList && !field.isGenerated,
  )
  if (stringFields.length === 0) return undefined

  return {
    OR: stringFields.map((field) => ({ [field.name]: { contains: term } })),
  }
}

export function buildWhere(
  model: ModelMetadata,
  query: Pick<ListQuery, 'filters' | 'search'>,
): Record<string, unknown> | undefined {
  const conditions: Array<Record<string, unknown>> = []

  for (const rule of query.filters ?? []) {
    conditions.push(toPrismaCondition(model, rule))
  }

  const search = query.search?.trim()
  if (search) {
    const searchCondition = toSearchCondition(model, search)
    if (searchCondition) conditions.push(searchCondition)
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return { AND: conditions }
}

function buildOrderBy(
  model: ModelMetadata,
  query: Pick<ListQuery, 'sort'>,
): Array<Record<string, 'asc' | 'desc'>> | undefined {
  const rules = query.sort ?? []
  if (rules.length === 0) return undefined

  return rules.map((rule) => {
    const field = findQueryableField(model, rule.field)
    return { [field.name]: rule.direction }
  })
}

/** Normalised, clamped pagination. Page numbers are 1-based. */
export function resolvePagination(query: Pick<ListQuery, 'page' | 'perPage'>): {
  page: number
  perPage: number
  skip: number
  take: number
} {
  const rawPage = query.page ?? 1
  if (!Number.isInteger(rawPage) || rawPage < 1) {
    throw new InvalidQueryError(
      `"page" must be an integer >= 1, received ${JSON.stringify(query.page)}.`,
    )
  }

  const rawPerPage = query.perPage ?? DEFAULT_PER_PAGE
  if (!Number.isInteger(rawPerPage) || rawPerPage < 1) {
    throw new InvalidQueryError(
      `"perPage" must be an integer >= 1, received ${JSON.stringify(query.perPage)}.`,
    )
  }

  // Clamped rather than rejected: a UI asking for too much should get a
  // capped page, not an error.
  const perPage = Math.min(rawPerPage, MAX_PER_PAGE)
  return { page: rawPage, perPage, skip: (rawPage - 1) * perPage, take: perPage }
}

export function toFindManyArgs(model: ModelMetadata, query: ListQuery): PrismaFindManyArgs {
  const { skip, take } = resolvePagination(query)
  const where = buildWhere(model, query)
  const orderBy = buildOrderBy(model, query)

  return {
    ...(where ? { where } : {}),
    ...(orderBy ? { orderBy } : {}),
    skip,
    take,
  }
}
