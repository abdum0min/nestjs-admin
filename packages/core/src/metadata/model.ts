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

/**
 * A relation, and how to act on it.
 *
 * `from` and `to` are what turn a relation from something an admin can only
 * display into something it can filter and write. A to-one relation is stored
 * as an ordinary scalar column - `Post.authorId` - and that column is what a
 * query has to be expressed in terms of. Without knowing its name, a filter on
 * `author` cannot be translated, and a form has no field to submit.
 *
 * Both are absent on to-many relations, which have no column on this side.
 */
export interface RelationMetadata {
  /** `name` of the {@link ModelMetadata} on the other side of the relation. */
  readonly targetModel: string
  readonly cardinality: RelationCardinality

  /**
   * Scalar field on **this** model holding the foreign key, for a to-one
   * relation - `authorId` on `Post.author`.
   *
   * Absent when the relation has no column on this side: every to-many, and
   * the non-owning half of a one-to-one.
   */
  readonly from?: string

  /** Field on the target model that `from` points at - usually its id. */
  readonly to?: string

  /**
   * Name shared by both halves of the relation.
   *
   * The only reliable way to pair `User.posts` with `Post.author`, which two
   * things need. Distinguishing a many-to-many from a one-to-many requires
   * looking at the other side - both are `'many'` from here, but only one has
   * no column anywhere. And knowing whether a child's key is required decides
   * whether it can be detached at all.
   *
   * Two relations between the same pair of models are told apart by it too:
   * `Post.author` and `Post.reviewer` both target `User`.
   */
  readonly name?: string
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
   * The value is produced by the database or the ORM and is not asked of the
   * user - `@default(cuid())`, `@default(now())`, `@default(autoincrement())`,
   * `@updatedAt`. Such fields are displayed but not editable.
   *
   * This is NOT "has a default". A field with a literal default
   * (`active Boolean @default(true)`) is an ordinary editable field that
   * happens to arrive pre-filled; see {@link FieldMetadata.defaultValue}.
   *
   * NAME COLLISION - read before implementing an adapter. Prisma's DMMF also
   * has a field called `isGenerated`, and it does NOT mean this. Measured
   * against Prisma 7.10.0, DMMF reports `isGenerated: false` for
   * `id String @id @default(cuid())`. Mapping it across directly produces
   * editable primary keys.
   * See reports/003-prisma-adapter.md for the correct derivation.
   */
  readonly isGenerated: boolean

  /**
   * Accepted on a write, never returned on a read.
   *
   * Set by `writeOnly` in the configuration. A password is the reason it
   * exists: it has to be typed into a form and must never come back out, and
   * `hidden` cannot express that - it refuses the field in both directions, so
   * a hidden password column leaves no way to set one.
   *
   * Enforced twice, deliberately: the field is left out of the columns the
   * adapter is asked for, *and* out of the projection applied to whatever comes
   * back. One of those is enough; two is what it takes for a future adapter
   * that ignores the field scope not to become a leak.
   */
  readonly writeOnly?: boolean
  /**
   * Literal default the admin should pre-fill on create, when the schema
   * declares one (`@default(true)`, `@default(0)`, `@default("USER")`).
   *
   * Absent for generated values: there is no literal to pre-fill for
   * `@default(now())`, and {@link FieldMetadata.isGenerated} is `true` instead.
   */
  readonly defaultValue?: unknown
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

  /**
   * Field that names a record of this model in one line, when the application
   * has declared one.
   *
   * A slot rather than a value: left unset, `displayFieldFor` works it out from
   * the fields. It is here so that a declared choice travels with the model and
   * reaches the adapter and the metadata document alike, without either of them
   * having to read configuration.
   */
  readonly displayField?: string
}
