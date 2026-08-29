/**
 * Normalised, ORM-independent description of a model and its fields.
 *
 * Every ORM adapter translates its own schema representation (Prisma DMMF,
 * TypeORM entity metadata, a Drizzle table object, ...) into these shapes.
 * Nothing downstream - the CRUD engine, the HTTP API, the admin UI - is
 * allowed to look at anything else.
 *
 * @experimental Draft contract. Expected to change during MVP implementation.
 */

/** ORM-independent classification of a scalar or relation field. */
export type FieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'enum'
  | 'json'
  | 'relation'
  /** The adapter recognised the field but cannot map it onto a known kind. */
  | 'unknown'

/** Cardinality of a relation from the owning model's point of view. */
export type RelationCardinality = 'one' | 'many'

export interface RelationMetadata {
  /** `name` of the {@link ModelMetadata} on the other side of the relation. */
  readonly targetModel: string
  readonly cardinality: RelationCardinality
}

export interface FieldMetadata {
  readonly name: string
  readonly kind: FieldKind
  /** Part of the model's primary key. */
  readonly isId: boolean
  readonly isRequired: boolean
  readonly isUnique: boolean
  /** The field holds a list of {@link FieldKind} values. */
  readonly isList: boolean
  /**
   * The value is produced by the database or the ORM (`@default`, `@updatedAt`,
   * autoincrement, ...). Such fields are shown but never edited by the admin.
   */
  readonly isGenerated: boolean
  /** Populated when `kind` is `'enum'`. */
  readonly enumValues?: readonly string[]
  /** Populated when `kind` is `'relation'`. */
  readonly relation?: RelationMetadata
}

export interface ModelMetadata {
  /** Adapter-facing identifier, e.g. the Prisma model name `User`. */
  readonly name: string
  /**
   * Field names forming the primary key. Modelled as a list rather than a
   * single `id` so composite keys do not require a breaking change later,
   * even though the MVP will only support single-column keys.
   */
  readonly primaryKey: readonly string[]
  readonly fields: readonly FieldMetadata[]
}
