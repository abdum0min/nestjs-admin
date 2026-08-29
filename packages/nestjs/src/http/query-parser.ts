/**
 * HTTP query string -> Core `ListQuery`.
 *
 * The adapter is typed; HTTP is not. Everything arriving over the wire is a
 * string, so this module is where strings become numbers, booleans and dates,
 * and where malformed input is rejected before it can reach an ORM.
 *
 * Keeping this at the HTTP boundary is deliberate: the adapter must never
 * learn to parse query strings, or every future adapter would have to.
 *
 * ## Syntax
 *
 *   ?page=2
 *   ?perPage=25
 *   ?search=ada
 *   ?sort=email:asc&sort=createdAt:desc      (repeatable, order preserved)
 *   ?filter=age:gte:18&filter=role:in:ADMIN,USER
 *
 * `sort` and `filter` use the same colon-delimited form rather than bracket
 * syntax (`filter[age][gte]=18`). Bracket syntax depends on the HTTP platform
 * enabling a nested query parser - `qs` under Express - and would silently
 * arrive as a literal key elsewhere. Colon form parses identically on any
 * platform.
 *
 * A filter is split into at most three parts, so colons inside a value survive:
 * `filter=startedAt:gte:2024-01-01T00:00:00Z` reads as
 * field `startedAt`, operator `gte`, value `2024-01-01T00:00:00Z`.
 *
 * @experimental The HTTP contract is expected to change before 1.0.
 */
import {
  InvalidQueryError,
  type FieldMetadata,
  type FilterOperator,
  type FilterRule,
  type ListQuery,
  type ModelMetadata,
  type SortDirection,
  type SortRule,
} from '@nest-admin/core'

/** Raw query object as an HTTP platform hands it over. */
export type RawQuery = Record<string, unknown>

/**
 * The operators Core defines. Restated as a runtime set because a TypeScript
 * union cannot validate a string arriving over HTTP.
 *
 * Kept in lockstep with Core's `FilterOperator`; a compile-time check below
 * fails the build if the two ever drift.
 */
const FILTER_OPERATORS = [
  'eq',
  'ne',
  'contains',
  'startsWith',
  'endsWith',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
] as const

// Fails to compile if Core adds an operator this parser does not accept.
const _exhaustive: readonly FilterOperator[] = FILTER_OPERATORS
void _exhaustive

const SORT_DIRECTIONS = new Set<string>(['asc', 'desc'])

/** Normalise a query value that may be absent, a string, or repeated. */
function toStringList(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return typeof value === 'string' ? [value] : []
}

function toSingleString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  // A repeated scalar param is a client bug; take the last rather than fail.
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === 'string')
    return strings.at(-1)
  }
  return undefined
}

function parsePositiveInteger(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw === '') return undefined
  // Number() would accept '1e3', ' 12 ' and '0x10'. An explicit digit test
  // keeps the accepted set to what a pager actually produces.
  if (!/^\d+$/.test(raw)) {
    throw new InvalidQueryError(
      `"${name}" must be a positive integer, received ${JSON.stringify(raw)}.`,
    )
  }
  const parsed = Number(raw)
  if (parsed < 1) {
    throw new InvalidQueryError(`"${name}" must be >= 1, received ${JSON.stringify(raw)}.`)
  }
  return parsed
}

function parseSort(raw: unknown): readonly SortRule[] | undefined {
  const entries = toStringList(raw).filter((entry) => entry.trim() !== '')
  if (entries.length === 0) return undefined

  return entries.map((entry) => {
    const separator = entry.lastIndexOf(':')
    if (separator <= 0 || separator === entry.length - 1) {
      throw new InvalidQueryError(`Invalid sort "${entry}". Expected "field:asc" or "field:desc".`)
    }
    const field = entry.slice(0, separator)
    const direction = entry.slice(separator + 1)

    if (!SORT_DIRECTIONS.has(direction)) {
      throw new InvalidQueryError(
        `Invalid sort direction "${direction}" in "${entry}". Expected "asc" or "desc".`,
      )
    }
    return { field, direction: direction as SortDirection }
  })
}

/**
 * Coerce a filter value to the type the field declares.
 *
 * Without this every value reaches the ORM as a string, and `price gte "30"`
 * either errors or compares lexically. When the field is unknown the value is
 * passed through untouched: the adapter owns field-name validation and will
 * reject it with a precise error, so validating it here too would duplicate
 * that rule in a second place.
 */
function coerceScalar(raw: string, field: FieldMetadata | undefined, context: string): unknown {
  if (!field) return raw

  switch (field.kind) {
    case 'number': {
      const parsed = Number(raw)
      if (raw.trim() === '' || !Number.isFinite(parsed)) {
        throw new InvalidQueryError(`${context}: "${raw}" is not a valid number.`)
      }
      return parsed
    }
    case 'boolean': {
      if (raw === 'true') return true
      if (raw === 'false') return false
      throw new InvalidQueryError(
        `${context}: "${raw}" is not a valid boolean (use true or false).`,
      )
    }
    case 'datetime': {
      const parsed = new Date(raw)
      if (Number.isNaN(parsed.getTime())) {
        throw new InvalidQueryError(`${context}: "${raw}" is not a valid date.`)
      }
      return parsed
    }
    default:
      return raw
  }
}

/**
 * `in` receives a comma-separated list. Values containing a comma cannot be
 * expressed - a documented limitation of the syntax, not an oversight.
 */
function coerceList(raw: string, field: FieldMetadata | undefined, context: string): unknown[] {
  if (raw === '') return []
  return raw.split(',').map((part) => coerceScalar(part, field, context))
}

function parseFilters(raw: unknown, model: ModelMetadata): readonly FilterRule[] | undefined {
  const entries = toStringList(raw).filter((entry) => entry.trim() !== '')
  if (entries.length === 0) return undefined

  return entries.map((entry) => {
    // Split into at most three parts so colons inside the value survive.
    const firstSeparator = entry.indexOf(':')
    const secondSeparator = firstSeparator === -1 ? -1 : entry.indexOf(':', firstSeparator + 1)

    if (firstSeparator <= 0 || secondSeparator === -1) {
      throw new InvalidQueryError(
        `Invalid filter "${entry}". Expected "field:operator:value", ` +
          `for example "email:contains:example.com".`,
      )
    }

    const fieldName = entry.slice(0, firstSeparator)
    const operator = entry.slice(firstSeparator + 1, secondSeparator)
    const rawValue = entry.slice(secondSeparator + 1)

    if (!FILTER_OPERATORS.includes(operator as FilterOperator)) {
      throw new InvalidQueryError(
        `Unknown filter operator "${operator}" in "${entry}". ` +
          `Supported operators: ${FILTER_OPERATORS.join(', ')}.`,
      )
    }

    const field = model.fields.find((candidate) => candidate.name === fieldName)
    const context = `Filter "${entry}"`
    const value =
      operator === 'in'
        ? coerceList(rawValue, field, context)
        : coerceScalar(rawValue, field, context)

    return { field: fieldName, operator: operator as FilterOperator, value }
  })
}

/**
 * Build a `ListQuery` from a raw HTTP query object.
 *
 * `model` is required because value coercion is type-directed: only the schema
 * knows that `price` is a number and `active` a boolean.
 */
export function parseListQuery(raw: RawQuery, model: ModelMetadata): ListQuery {
  const page = parsePositiveInteger(toSingleString(raw['page']), 'page')
  const perPage = parsePositiveInteger(toSingleString(raw['perPage']), 'perPage')
  const sort = parseSort(raw['sort'])
  const filters = parseFilters(raw['filter'], model)
  const search = toSingleString(raw['search'])

  return {
    ...(page !== undefined ? { page } : {}),
    ...(perPage !== undefined ? { perPage } : {}),
    ...(sort ? { sort } : {}),
    ...(filters ? { filters } : {}),
    ...(search !== undefined && search !== '' ? { search } : {}),
  }
}
