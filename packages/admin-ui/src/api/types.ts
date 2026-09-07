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

export type FieldWidget =
  | 'textarea'
  | 'password'
  | 'email'
  | 'url'
  | 'color'
  | 'json'
  | 'file'
  | 'image'
  /** Formatted text on a string column, stored as HTML. */
  | 'richtext'

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
  /** What a file field accepts, and how large. Enforced again on the server. */
  readonly accept?: readonly string[]
  readonly maxSize?: number
  /** A picture to draw when a file field is empty or its value will not load. */
  readonly placeholder?: string
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

/** How the application wants the list screen to look. Presentation only. */
export interface ListPresentation {
  /** The columns, in this order. Without it the table picks the first six. */
  readonly columns?: readonly string[]
  readonly sort?: { readonly field: string; readonly direction: 'asc' | 'desc' }
  /** Rows per page before the viewer chooses. Their choice wins over it. */
  readonly perPage?: number
}

/**
 * One group of fields on the record screen.
 *
 * Resolved by the server, which means two things the interface can rely on:
 * every field named here exists, and whatever no group claimed is already in a
 * final group of its own. A section never hides a field.
 */
export interface DetailSection {
  readonly heading: string
  readonly description?: string
  readonly fields: readonly string[]
  readonly collapsed?: boolean
}

export interface DetailPresentation {
  readonly layout: 'sections' | 'tabs'
  readonly sections: readonly DetailSection[]
}

/**
 * The navigation, as the server resolved it.
 *
 * Groups already contain only the models this principal can see, and empty
 * ones are gone - so there is no rule here about hiding a heading whose models
 * were all refused. Drawing it is the whole job.
 */
export type NavigationEntry =
  | {
      readonly kind: 'group'
      readonly heading?: string
      readonly models: readonly string[]
      readonly collapsed?: boolean
    }
  | {
      readonly kind: 'link'
      readonly label: string
      readonly href: string
      readonly icon?: ModelIcon
      readonly external?: boolean
    }
  | { readonly kind: 'divider' }

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
  /** How the list screen should look, when the application said. */
  readonly list?: ListPresentation
  /** How the record screen should be arranged, when the application said. */
  readonly detail?: DetailPresentation
  /**
   * What this principal may do. Not the enforcement - every request is checked
   * again - but what the interface should offer.
   */
  readonly can?: ModelPermissions
  /**
   * The field to send back as a version on a write.
   *
   * Named by the server, and present only when it is actually checking. The
   * interface never works it out for itself.
   */
  readonly versionField?: string
  /**
   * The column that marks a record deleted, when this model keeps its rows.
   *
   * Present only where the application configured soft delete. It is what
   * turns Delete into something that can be undone: the list gains a view of
   * the marked records, a marked record gains Restore, and the confirmation
   * stops saying "this cannot be undone" - because it can.
   */
  readonly softDeleteField?: string
  /** Buttons the application added, already filtered by the policy. */
  readonly actions?: readonly ActionDescriptor[]
}

export interface Metadata {
  readonly models: readonly ModelDescriptor[]
  /**
   * Absent from a server older than 0.12, and treated as nothing permitted -
   * which is right: a screen this build has never heard of should not appear
   * because an older server did not mention it.
   */
  readonly capabilities?: Capabilities
  /**
   * How to group the resources.
   *
   * Absent from a server that was not told how - and from every server older
   * than this feature - which means one flat list, as it always was.
   */
  readonly navigation?: readonly NavigationEntry[]
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
  | 'CONFLICT'
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
  /**
   * Which records to show on a model that keeps its deleted rows.
   *
   * Omitted means live records only, which is what every list showed before
   * soft delete existed. Sent only for a model whose metadata carries a
   * `softDeleteField`: anywhere else the server refuses it, deliberately, so a
   * request for deleted records is never answered with the live ones.
   */
  readonly deleted?: DeletedView
}

/** The three views of a list on a model that marks records deleted. */
export type DeletedView = 'live' | 'deleted' | 'all'

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

/** Who is signed in, when the admin has a login of its own. */
export interface AdminAccountSummary {
  readonly id: string
  readonly email: string
  readonly name?: string
  /**
   * Present only when the admin declares roles.
   *
   * Shown, never acted on: what a role may do is decided on the server for
   * every request, and the interface withholds controls from the `can` block
   * in the metadata rather than from this.
   */
  readonly role?: string
}

export interface AdminSession {
  /** `null` when nobody is signed in - which is a state, not a failure. */
  readonly account: AdminAccountSummary | null
}

/** How wide a dashboard widget sits in the four-column grid. */
export type WidgetSpan = 1 | 2 | 3 | 4

export interface WidgetDescriptor {
  readonly id: string
  readonly kind: 'count' | 'list' | 'chart' | 'stat'
  readonly title: string
  readonly description?: string
  readonly span: WidgetSpan
  /** Which model it reads, so the widget can link to that list. */
  readonly model?: string
  /** The list view this widget summarises, as `field:op:value`. */
  readonly filter?: string
  /** Shaped by `kind`. Absent when `failed`. */
  readonly data?: unknown
  /** This one could not be loaded. The others on the page still were. */
  readonly failed?: boolean
}

export interface Dashboard {
  readonly widgets: readonly WidgetDescriptor[]
  /** True when nothing was declared and this was built from the schema. */
  readonly generated: boolean
}

export interface CountData {
  readonly value: number
  readonly delta?: number
  readonly hint?: string
}

export interface StatData {
  readonly value: string | number
  readonly delta?: number
  readonly hint?: string
}

export interface ListData {
  readonly records: readonly { readonly id: string; readonly label: string }[]
  readonly total: number
}

export interface ChartData {
  readonly points: readonly { readonly at: string; readonly value: number }[]
  readonly total: number
}

/** One account that can sign in to the admin. Never carries a password hash. */
export interface TeamMember {
  readonly id: string
  readonly email: string
  readonly name?: string
  readonly role?: string
  readonly disabled: boolean
  /** True for the account viewing the page - the rules are all about this. */
  readonly isYou: boolean
}

export interface TeamView {
  readonly members: readonly TeamMember[]
  /** False when the account store can be read but not written. */
  readonly writable: boolean
  /** Role names to offer, in the order the application declared them. */
  readonly roles: readonly string[]
}

/** What this principal may do that is not about a model. */
export interface Capabilities {
  readonly manageTeam: boolean
  /**
   * Both halves at once: this build has the developer tools, and this role
   * may use them. The interface cannot tell the two apart, which is right -
   * either way they are not part of this admin.
   */
  readonly useDevTools?: boolean

  /** Whether this role may download a model as a CSV or JSON file. */
  readonly exportData?: boolean
}

/* ------------------------------------------------------------ import/export */

export type TransferFormat = 'csv' | 'json'

/** A field an import can write, and what a value for it has to satisfy. */
export interface ImportTargetInfo {
  readonly field: string
  readonly kind: FieldKind
  readonly required: boolean
  readonly unique: boolean
  readonly enumValues?: readonly string[]
  /** Set when the column is a relation's key: a cell may hold a key or a name. */
  readonly relation?: {
    readonly model: string
    readonly to: string
    readonly display: string
  }
}

/** What a file turned out to contain, before anybody has decided anything. */
export interface ImportShape {
  readonly columns: readonly string[]
  readonly rows: number
  readonly truncated: boolean
  readonly targets: readonly ImportTargetInfo[]
  readonly matchable: readonly string[]
  readonly mapping: Readonly<Record<string, string>>
  readonly sample: readonly Readonly<Record<string, string>>[]
}

export interface PlannedRow {
  readonly line: number
  readonly action: 'create' | 'update' | 'refused'
  readonly id?: string | number
  readonly values: AdminRecord
  readonly problems: readonly string[]
}

/** A dry run: everything an import would do, having done none of it. */
export interface ImportPlan {
  readonly matchBy: string | null
  readonly mapping: Readonly<Record<string, string>>
  readonly create: number
  readonly update: number
  readonly refused: number
  /** A sample, plus every refused row. The counts are of the whole file. */
  readonly rows: readonly PlannedRow[]
}

export interface ImportOutcome {
  readonly created: number
  readonly updated: number
  readonly failed: readonly { readonly line: number; readonly message: string }[]
}
