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
  /** Shared by both halves, so the other side can be found. */
  readonly name?: string
  /** Where the link is stored, which decides what may be done to it. */
  readonly shape?: 'to-one' | 'one-to-many' | 'many-to-many'
  /** Why records cannot be detached, when they cannot. */
  readonly detachBlocked?: string
  /** The column on the target that points back here. One-to-many only. */
  readonly targetForeignKey?: string
}

export type FieldWidget = 'textarea' | 'password' | 'email' | 'url' | 'color' | 'json'

/** An application-defined button. */
export interface ActionDescriptor {
  readonly name: string
  readonly label: string
  readonly scope: 'record' | 'list'
  readonly confirm?: string
  readonly danger?: boolean
}

/** Which operations the current principal may perform on a model. */
export interface ModelPermissions {
  readonly list: boolean
  readonly read: boolean
  readonly create: boolean
  readonly update: boolean
  readonly delete: boolean
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
  /** The admin will refuse to write this field. */
  readonly readOnly?: boolean
  /** The admin accepts this field on a write and never sends it back. */
  readonly writeOnly?: boolean
  /** What to call it, when the column name is not what people call it. */
  readonly label?: string
  /** How to edit it, when the kind does not say enough. */
  readonly widget?: FieldWidget
  /** Literal default to pre-fill on create, when the schema declares one. */
  readonly defaultValue?: unknown
  readonly enumValues?: readonly string[]
  readonly relation?: RelationDescriptor
}

/**
 * Icons a model may be given in the navigation.
 *
 * A closed list, mirroring `ModelIcon` in the server's metadata. Closed for two
 * reasons: the interface has to know how to draw each name, and only the names
 * here are bundled - the icon set has about fifteen hundred entries.
 */
export type ModelIcon =
  | 'users'
  | 'user'
  | 'building'
  | 'box'
  | 'package'
  | 'tag'
  | 'shopping-cart'
  | 'credit-card'
  | 'receipt'
  | 'file-text'
  | 'folder'
  | 'image'
  | 'calendar'
  | 'clock'
  | 'mail'
  | 'message-square'
  | 'bell'
  | 'star'
  | 'map-pin'
  | 'globe'
  | 'settings'
  | 'key'
  | 'shield'
  | 'database'
  | 'table'
  | 'layers'
  | 'list'
  | 'chart-bar'
  | 'activity'
  | 'truck'
  | 'gift'
  | 'bookmark'
  | 'link'

export interface ModelDescriptor {
  readonly name: string
  readonly primaryKey: readonly string[]
  readonly fields: readonly FieldDescriptor[]
  /** Field that names a record of this model in one line. */
  readonly displayField: string
  /** What to call the model. */
  readonly label?: string
  /** Which icon to draw beside it in the navigation, if the application chose one. */
  readonly icon?: ModelIcon
  /**
   * What this principal may do. Not the enforcement - every request is checked
   * again - but what the interface should offer.
   */
  readonly can?: ModelPermissions
  /** Buttons the application added, already filtered by the policy. */
  readonly actions?: readonly ActionDescriptor[]
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
  | 'VALIDATION_ERROR'
  | 'CONSTRAINT_VIOLATION'
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

/** What happened to each record a bulk delete named. */
export interface BulkDeleteResult {
  readonly deleted: readonly string[]
  /** Records still in place, and why. The messages are safe to show. */
  readonly failed: readonly { readonly id: string; readonly message: string }[]
}

export interface ListResult {
  readonly records: readonly AdminRecord[]
  readonly meta: PageMeta
}
