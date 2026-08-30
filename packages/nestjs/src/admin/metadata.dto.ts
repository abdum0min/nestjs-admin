/**
 * The public HTTP representation of model metadata.
 *
 * This is the contract between the backend and any future admin frontend, and
 * it is deliberately declared separately from Core's `ModelMetadata` rather
 * than serialised straight from it. Two reasons:
 *
 *   1. Core's contract is marked `@experimental` and will keep moving. The wire
 *      format must not move with it by accident.
 *   2. An explicit mapper is a whitelist. If a future adapter puts something
 *      ORM-specific on `FieldMetadata`, it cannot silently reach a client.
 *
 * Nothing here mentions Prisma, DMMF, or any ORM. Replacing the Prisma adapter
 * with another one must not change a single byte of this shape.
 *
 * @experimental The HTTP contract is expected to change before 1.0.
 */
import { displayFieldFor, type FieldMetadata, type ModelMetadata } from '@nest-admin/core'

/** Mirrors Core's `FieldKind`, restated so the wire format is self-contained. */
export type FieldKindDto =
  'string' | 'number' | 'boolean' | 'datetime' | 'enum' | 'json' | 'relation' | 'unknown'

export interface RelationDto {
  readonly targetModel: string
  readonly cardinality: 'one' | 'many'

  /**
   * Scalar field on this model holding the key, for a to-one relation.
   *
   * The UI needs it twice over: it is the field a form submits when the user
   * picks a related record, and the field a filter is expressed in. Absent on
   * to-many relations, which have no column on this side.
   */
  readonly from?: string

  /** Field on the target the key points at - usually its id. */
  readonly to?: string
}

export interface FieldDto {
  readonly name: string
  readonly kind: FieldKindDto
  /** Part of the model's primary key. */
  readonly isId: boolean
  readonly isRequired: boolean
  readonly isUnique: boolean
  readonly isList: boolean
  /**
   * Produced by the database or ORM (`cuid()`, `now()`, `autoincrement()`,
   * `@updatedAt`). Display it; do not ask the user for it.
   */
  readonly isGenerated: boolean
  /**
   * Literal default to pre-fill on create. Present only for editable fields
   * that declare one - a generated value has no literal to pre-fill.
   */
  readonly defaultValue?: unknown
  /** Present when `kind` is `'enum'`. */
  readonly enumValues?: readonly string[]
  /** Present when `kind` is `'relation'`. */
  readonly relation?: RelationDto
}

export interface ModelDto {
  readonly name: string
  /** Field names forming the primary key. Single-column in this version. */
  readonly primaryKey: readonly string[]
  readonly fields: readonly FieldDto[]

  /**
   * Field that names a record of this model in one line.
   *
   * Sent rather than left for the UI to guess, because the guess would have to
   * match what the adapter already selected when it loaded the relation. Both
   * come from one rule in Core, so they cannot disagree.
   */
  readonly displayField: string
}

export interface MetadataDto {
  readonly models: readonly ModelDto[]
}

function toFieldDto(field: FieldMetadata): FieldDto {
  // Built property by property on purpose. A spread would forward anything a
  // future adapter attaches to FieldMetadata straight onto the wire.
  return {
    name: field.name,
    kind: field.kind,
    isId: field.isId,
    isRequired: field.isRequired,
    isUnique: field.isUnique,
    isList: field.isList,
    isGenerated: field.isGenerated,
    ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
    ...(field.enumValues ? { enumValues: [...field.enumValues] } : {}),
    ...(field.relation
      ? {
          relation: {
            targetModel: field.relation.targetModel,
            cardinality: field.relation.cardinality,
            ...(field.relation.from !== undefined ? { from: field.relation.from } : {}),
            ...(field.relation.to !== undefined ? { to: field.relation.to } : {}),
          },
        }
      : {}),
  }
}

/**
 * Build the metadata document from the models that belong in it.
 *
 * Relation fields pointing at a model that is **not** in `models` are dropped.
 * This is a document-coherence rule, not a permission rule - the mapper makes
 * no authorization decision and does not know one was made. It simply refuses
 * to emit a reference to something the document does not contain, because a
 * dangling `targetModel` is not renderable by any client.
 *
 * It also closes a real leak. When a caller filters the model list - as
 * resource authorization does - dropping `Post` while keeping `User.posts`
 * would still publish the hidden model's name through `relation.targetModel`,
 * and the relation field's own name along with it.
 */
export function toMetadataDto(models: readonly ModelMetadata[]): MetadataDto {
  const present = new Set(models.map((model) => model.name))

  return {
    models: models.map((model) => ({
      name: model.name,
      primaryKey: [...model.primaryKey],
      displayField: displayFieldFor(model),
      fields: model.fields
        .filter((field) => !field.relation || present.has(field.relation.targetModel))
        .map(toFieldDto),
    })),
  }
}
