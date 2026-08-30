/**
 * The admin HTTP contract, as the browser sees it.
 *
 * These shapes are declared here by hand rather than imported from
 * `@nest-admin/core` or the NestJS package, and that is the point: the UI is a
 * client of a JSON API, not of the backend's internals. It must keep working
 * against a server that swapped Prisma for another ORM, and it must not be
 * able to reach a type that only exists because of one.
 *
 *     Admin UI  ->  HTTP JSON  ->  NestJS  ->  Core  ->  Adapter  ->  ORM
 *
 * Never Admin UI -> Core.
 *
 * Mirrors the server's DTO (`packages/nestjs/src/admin/metadata.dto.ts`). If
 * the two drift, the contract test in `test/contract.test.ts` is where it
 * should surface.
 */

export type FieldKind =
  'string' | 'number' | 'boolean' | 'datetime' | 'enum' | 'json' | 'relation' | 'unknown'

export interface RelationDescriptor {
  readonly targetModel: string
  readonly cardinality: 'one' | 'many'
  /** Scalar field on this model holding the key. To-one relations only. */
  readonly from?: string
  /** Field on the target the key points at. */
  readonly to?: string
}

export interface FieldDescriptor {
  readonly name: string
  readonly kind: FieldKind
  readonly isId: boolean
  readonly isRequired: boolean
  readonly isUnique: boolean
  readonly isList: boolean
  /** Produced by the database or ORM. Displayed, never asked of the user. */
  readonly isGenerated: boolean
  /** Literal default to pre-fill on create, when the schema declares one. */
  readonly defaultValue?: unknown
  readonly enumValues?: readonly string[]
  readonly relation?: RelationDescriptor
}

export interface ModelDescriptor {
  readonly name: string
  readonly primaryKey: readonly string[]
  readonly fields: readonly FieldDescriptor[]
  /** Field that names a record of this model in one line. */
  readonly displayField: string
}

export interface Metadata {
  readonly models: readonly ModelDescriptor[]
}

/** A record as it crosses the wire. Values are whatever JSON allows. */
export type AdminRecord = Record<string, unknown>

export interface PageMeta {
  readonly total: number
  readonly page: number
  readonly perPage: number
}

/**
 * Error codes the server documents. Clients branch on these, never on the
 * message text, which is free to change.
 */
export type AdminErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'MODEL_NOT_FOUND'
  | 'RECORD_NOT_FOUND'
  | 'FIELD_NOT_FOUND'
  | 'INVALID_QUERY'
  | 'INTERNAL_ERROR'

export interface SuccessEnvelope<T> {
  readonly success: true
  readonly data: T
  readonly meta?: PageMeta
}

export interface ErrorEnvelope {
  readonly success: false
  readonly error: {
    readonly code: AdminErrorCode
    readonly message: string
    readonly details?: Readonly<Record<string, unknown>>
  }
}

/** The operator set the server accepts. The UI must not invent others. */
export type FilterOperator =
  'eq' | 'ne' | 'contains' | 'startsWith' | 'endsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'

export interface FilterRule {
  readonly field: string
  readonly operator: FilterOperator
  /** Already stringified for the wire; `in` uses a comma-separated list. */
  readonly value: string
}

export interface SortRule {
  readonly field: string
  readonly direction: 'asc' | 'desc'
}

export interface ListQuery {
  readonly page?: number
  readonly perPage?: number
  readonly search?: string
  readonly sort?: readonly SortRule[]
  readonly filters?: readonly FilterRule[]
}

export interface ListResult {
  readonly records: readonly AdminRecord[]
  readonly meta: PageMeta
}
