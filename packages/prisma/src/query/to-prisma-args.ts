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
 * What the field is being resolved for.
 *
 * Only relations care, and they care because the two cases are not symmetric.
 * See {@link findQueryableField}.
 */
type QueryPurpose = 'filter' | 'sort'

/**
 * A field usable in a filter or a sort.
 *
 * A to-one relation the model owns is stored in a scalar column, so a **filter**
 * on `author` is answerable: it means exactly a filter on `authorId`, and the
 * caller gets to use whichever name they think in.
 *
 * **Sorting** by it is refused, even though it would run. `authorId` holds a
 * cuid, so ordering by it is ordering by a random-looking string - a result
 * that looks sorted, is stable, and means nothing. What someone asking to sort
 * by `author` wants is the author's *name*, which is sorting by a field on
 * another model and is not this version. A refusal that says so is better than
 * a page of rows in an order nobody can explain.
 *
 * List fields are excluded outright: there is no column on this side at all.
 */
function findQueryableField(
  model: ModelMetadata,
  fieldName: string,
  purpose: QueryPurpose,
): FieldMetadata {
  const field = model.fields.find((candidate) => candidate.name === fieldName)
  if (!field) {
    throw new FieldNotFoundError(model.name, fieldName)
  }
  if (field.kind === 'relation') {
    const owned = field.relation?.from
    if (owned !== undefined && field.relation?.cardinality === 'one') {
      if (purpose === 'filter') return findQueryableField(model, owned, purpose)

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

function toPrismaCondition(model: ModelMetadata, rule: FilterRule): Record<string, unknown> {
  const field = findQueryableField(model, rule.field, 'filter')

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
 * Providers where Prisma accepts `mode: 'insensitive'`.
 *
 * The list is short because Prisma *throws* on the others rather than ignoring
 * the option, so being wrong here breaks every search rather than degrading it.
 *
 * The omissions are deliberate, not oversights:
 *
 * | Provider   | Why nothing is sent                                        |
 * | ---------- | ---------------------------------------------------------- |
 * | mysql      | Its default collations end in `_ci`; `LIKE` already ignores case. |
 * | sqlite     | `LIKE` is case-insensitive for ASCII by default.            |
 * | sqlserver  | Its default collation is case-insensitive.                  |
 * | cockroachdb | Prisma documents `mode` for PostgreSQL and MongoDB only.   |
 *
 * So on the four below, the option is unnecessary; on CockroachDB it is
 * unproven, and this is not the place to guess.
 */
const INSENSITIVE_MODE_PROVIDERS: ReadonlySet<string> = new Set([
  'postgresql',
  'postgres',
  'mongodb',
])

/**
 * The case-insensitivity option for this provider, if it takes one.
 *
 * Spread into every string comparison. Returning an object to spread rather
 * than a boolean to branch on keeps the option out of the query entirely where
 * it is not supported - Prisma rejects `mode: undefined` as readily as it
 * rejects `mode: 'insensitive'` on SQLite.
 */
export function insensitively(provider: string | undefined): { mode?: 'insensitive' } {
  return provider !== undefined && INSENSITIVE_MODE_PROVIDERS.has(provider)
    ? { mode: 'insensitive' }
    : {}
}

/** String comparisons, which are the ones capitalisation applies to. */
const TEXTUAL_OPERATORS: ReadonlySet<string> = new Set(['contains', 'startsWith', 'endsWith'])

/**
 * Free-text search: `contains` across the model's meaningful string fields.
 *
 * Generated string fields are excluded. A `cuid()` or `uuid()` primary key is
 * an opaque machine value, and including it makes single-letter searches match
 * essentially at random - searching "e" returns any record whose id happens to
 * contain an "e". Looking a record up by its id is an exact-match concern, so
 * it belongs in a filter (`{ field: 'id', operator: 'eq' }`), not in free text.
 *
 * Capitalisation is ignored, which needed the provider to say so. Searching
 * "ada" and getting nothing because the record says "Ada" is the kind of defect
 * people conclude the search is broken from, and they are not wrong. What it
 * takes to ignore case differs per database, and on some of them the option
 * that does it is an error - hence `insensitively`.
 */
function toSearchCondition(
  model: ModelMetadata,
  term: string,
  provider: string | undefined,
): Record<string, unknown> | undefined {
  // Foreign keys are string columns holding a cuid, so they match the same
  // rule the generated-id exclusion exists for - and they are not generated,
  // so that rule misses them. Left in, a search for "e" matches almost every
  // row of any model that references another, because most cuids contain an e.
  const foreignKeys = new Set(
    model.fields.map((field) => field.relation?.from).filter((name) => name !== undefined),
  )

  const stringFields = model.fields.filter(
    (field) =>
      field.kind === 'string' &&
      !field.isList &&
      !field.isGenerated &&
      !foreignKeys.has(field.name),
  )
  if (stringFields.length === 0) return undefined

  return {
    OR: stringFields.map((field) => ({
      [field.name]: { contains: term, ...insensitively(provider) },
    })),
  }
}

export function buildWhere(
  model: ModelMetadata,
  query: Pick<ListQuery, 'filters' | 'search'>,
  provider?: string,
): Record<string, unknown> | undefined {
  const conditions: Array<Record<string, unknown>> = []

  for (const rule of query.filters ?? []) {
    const condition = toPrismaCondition(model, rule)
    // A "contains" filter is the same promise the search box makes, typed into
    // a different box. It would be strange for one to ignore case and not the
    // other, and stranger still to have to know which.
    conditions.push(
      TEXTUAL_OPERATORS.has(rule.operator) ? insensitive(condition, provider) : condition,
    )
  }

  const search = query.search?.trim()
  if (search) {
    const searchCondition = toSearchCondition(model, search, provider)
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
    const field = findQueryableField(model, rule.field, 'sort')
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

/**
 * The same condition, told to ignore case.
 *
 * A condition is `{ field: { operator: value } }`, and the option belongs
 * beside the operator rather than beside the field, so it cannot simply be
 * spread at the top level.
 */
function insensitive(
  condition: Record<string, unknown>,
  provider: string | undefined,
): Record<string, unknown> {
  const mode = insensitively(provider)
  if (mode.mode === undefined) return condition

  const entries = Object.entries(condition).map(([field, comparison]) => [
    field,
    typeof comparison === 'object' && comparison !== null
      ? { ...(comparison as Record<string, unknown>), ...mode }
      : comparison,
  ])
  return Object.fromEntries(entries) as Record<string, unknown>
}

export function toFindManyArgs(
  model: ModelMetadata,
  query: ListQuery,
  provider?: string,
): PrismaFindManyArgs {
  const { skip, take } = resolvePagination(query)
  const where = buildWhere(model, query, provider)
  const orderBy = buildOrderBy(model, query)

  return {
    ...(where ? { where } : {}),
    ...(orderBy ? { orderBy } : {}),
    skip,
    take,
  }
}
