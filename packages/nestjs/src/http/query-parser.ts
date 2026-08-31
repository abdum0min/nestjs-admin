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
 * syntax (`filter[age][gte]=18`), which parses differently on every platform.
 * Bracket syntax is rejected with a 400 rather than ignored - see
 * `rejectUnknownParameters` for why that took two guards.
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

/**
 * Reject a parameter that arrived as a structure rather than text.
 *
 * Express parses `?filter[age][gte]=18` into `{ filter: { age: { gte: '18' } } }`.
 * Every value this parser understands is a string or a list of strings, so an
 * object could only ever be bracket syntax - which this API does not use.
 *
 * It previously fell through as "no value", which meant the request **succeeded
 * with the filter silently dropped**: a caller believed it had filtered and
 * received every record instead. Returning more rows than asked for, quietly,
 * is worse than refusing the request, so this is now a 400 that names the
 * syntax the server does accept.
 */
function rejectStructuredValue(name: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string') return
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return

  throw new InvalidQueryError(
    `"${name}" must be a plain value, not a nested structure. ` +
      'This API uses colon syntax - for example ' +
      '"?filter=age:gte:18" and "?sort=email:asc", not "?filter[age][gte]=18".',
  )
}

/** Every parameter this API understands. Anything else is a client mistake. */
const KNOWN_PARAMETERS = new Set(['page', 'perPage', 'search', 'sort', 'filter'])

/**
 * Reject query parameters the API does not define.
 *
 * The motivating case is bracket syntax, and it needs this *as well as*
 * `rejectStructuredValue` because how it arrives depends on the platform's
 * query parser. Measured on Express 5 under NestJS 12, which uses the simple
 * parser, `?filter[age][gte]=18` arrives as a literal key:
 *
 *     { 'filter[age][gte]': '18' }
 *
 * so nothing lands on `filter` at all. Under an extended parser (`qs`) the same
 * URL arrives as a nested object on `filter` instead. One guard catches each
 * shape, which is what keeps the behaviour identical on either platform.
 *
 * Either way the old outcome was the dangerous one: the request succeeded and
 * the filter was silently dropped, so a caller believed it had filtered and got
 * every record back.
 *
 * The strictness is deliberate beyond that case. An unrecognised parameter is
 * always a bug - a typo, a stale client, a half-migrated integration - and
 * ignoring it is what let this go unnoticed in the first place.
 */
function rejectUnknownParameters(raw: RawQuery): void {
  const unknown = Object.keys(raw).filter((key) => !KNOWN_PARAMETERS.has(key))
  if (unknown.length === 0) return

  const looksBracketed = unknown.some((key) => key.includes('['))
  const hint = looksBracketed
    ? ' This API uses colon syntax: "?filter=age:gte:18", not "?filter[age][gte]=18".'
    : ''

  throw new InvalidQueryError(
    `Unknown query parameter${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. ` +
      `Supported: ${[...KNOWN_PARAMETERS].join(', ')}.${hint}`,
  )
}

/** Normalise a query value that may be absent, a string, or repeated. */
function toStringList(name: string, value: unknown): string[] {
  rejectStructuredValue(name, value)
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return typeof value === 'string' ? [value] : []
}

function toSingleString(name: string, value: unknown): string | undefined {
  rejectStructuredValue(name, value)
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
  const entries = toStringList('sort', raw).filter((entry) => entry.trim() !== '')
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
  const entries = toStringList('filter', raw).filter((entry) => entry.trim() !== '')
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
 * One `field:operator:value` expression, coerced against the schema.
 *
 * The dashboard's declared filters use the same syntax as the list screen's
 * URL, and they have to mean the same thing: `active:eq:true` is the boolean
 * `true` in both places, not the string. Sharing the parser is what guarantees
 * that - a second implementation would drift, and its drift would be silent,
 * because a filter that coerces wrongly returns no rows rather than an error.
 */
export function parseFilterExpression(entry: string, model: ModelMetadata): FilterRule {
  const rules = parseFilters(entry, model)
  const rule = rules?.[0]
  if (rule === undefined) {
    throw new InvalidQueryError(
      `Expected a filter of the form "field:operator:value", got "${entry}".`,
    )
  }
  return rule
}

/**
 * Build a `ListQuery` from a raw HTTP query object.
 *
 * `model` is required because value coercion is type-directed: only the schema
 * knows that `price` is a number and `active` a boolean.
 */
export function parseListQuery(raw: RawQuery, model: ModelMetadata): ListQuery {
  rejectUnknownParameters(raw)

  const page = parsePositiveInteger(toSingleString('page', raw['page']), 'page')
  const perPage = parsePositiveInteger(toSingleString('perPage', raw['perPage']), 'perPage')
  const sort = parseSort(raw['sort'])
  const filters = parseFilters(raw['filter'], model)
  const search = toSingleString('search', raw['search'])

  return {
    ...(page !== undefined ? { page } : {}),
    ...(perPage !== undefined ? { perPage } : {}),
    ...(sort ? { sort } : {}),
    ...(filters ? { filters } : {}),
    ...(search !== undefined && search !== '' ? { search } : {}),
  }
}
