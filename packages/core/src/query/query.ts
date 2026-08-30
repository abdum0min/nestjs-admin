/**
 * ORM-independent query description.
 *
 * The admin UI and the HTTP layer speak only this vocabulary; each adapter is
 * responsible for translating it into its own query language.
 *
 * @experimental Draft contract. Expected to change during MVP implementation.
 */

export type SortDirection = 'asc' | 'desc'

export interface SortRule {
  readonly field: string
  readonly direction: SortDirection
}

/**
 * The deliberately small operator set the MVP targets. Anything richer
 * (nested relation filters, OR/AND trees, full-text) is a later concern and
 * should extend this union rather than bypass it.
 */
export type FilterOperator =
  'eq' | 'ne' | 'contains' | 'startsWith' | 'endsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'

export interface FilterRule {
  readonly field: string
  readonly operator: FilterOperator
  readonly value: unknown
}

/** Page-number based pagination. Cursor pagination is a later addition. */
export interface ListQuery {
  readonly page?: number
  readonly perPage?: number
  readonly sort?: readonly SortRule[]
  readonly filters?: readonly FilterRule[]
  /** Free-text term the adapter applies across searchable string fields. */
  readonly search?: string

  /**
   * The fields this query may touch, and the only ones it should return.
   *
   * Set by the caller that knows which fields the admin exposes - the adapter
   * reads a schema, not a configuration. Without it, a field the application
   * hid would still be searched by free text, sortable, filterable and
   * returned, because from the adapter's side it is an ordinary column.
   *
   * Omitted means "every field the model has".
   */
  readonly fields?: readonly string[]
}

export interface Page<T> {
  readonly data: readonly T[]
  readonly total: number
  readonly page: number
  readonly perPage: number
}
