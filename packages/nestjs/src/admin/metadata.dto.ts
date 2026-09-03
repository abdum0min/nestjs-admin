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
import { toBytes } from '../files/sniff.js'
import {
  detachBlockedReason,
  displayFieldFor,
  type ModelIcon,
  fieldOverride,
  isReadOnly,
  inverseRelationField,
  relationShape,
  type FieldMetadata,
  type ModelMetadata,
  type ModelOverrides,
} from '@nest-admin/core'

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

  /**
   * Where the link is stored, which decides what may be done to it.
   *
   * Computed on the server rather than left for the client to derive, for the
   * same reason as `displayField`: working it out needs the other half of the
   * relation, and two implementations of that rule would drift. A client that
   * guessed wrong would offer a button that cannot work.
   */
  readonly shape?: 'to-one' | 'one-to-many' | 'many-to-many'

  /**
   * Why records cannot be detached from this relation, when they cannot.
   *
   * Present only for a one-to-many whose child key is required: such a child
   * cannot exist without a parent, so there is nothing to detach it to.
   */
  readonly detachBlocked?: string

  /**
   * The column on the target model that points back at this one.
   *
   * What "all the posts by this author" is expressed as:
   * `?filter=<targetForeignKey>:eq:<parentId>`. Present only for a one-to-many,
   * since a many-to-many has no such column on either side.
   *
   * Sent rather than derived, for the same reason as `shape`: finding it means
   * pairing the two halves of the relation, and a rule implemented twice is a
   * rule that will eventually disagree with itself.
   */
  readonly targetForeignKey?: string
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

  /**
   * What to call the field, when the column name is not what people call it.
   *
   * Absent unless the application said so. A client falls back to `name`.
   */
  readonly label?: string

  /**
   * How the field should be edited, when its kind does not say enough.
   *
   * A `string` column may be a sentence, a password or a colour, and the schema
   * cannot tell them apart.
   */
  readonly widget?: 'textarea' | 'password' | 'email' | 'url' | 'color' | 'json' | 'file' | 'image'

  /**
   * What a file field accepts, and how large.
   *
   * Sent so the picker can filter and the interface can refuse an obviously
   * oversized file before uploading it. Both are enforced again on the server,
   * from the bytes - this is a courtesy, not the rule.
   */
  readonly accept?: readonly string[]
  readonly maxSize?: number

  /**
   * The admin will refuse to write this field.
   *
   * True for generated columns, and for anything the application marked
   * read-only. Enforced: a write naming it is rejected, so a client that
   * ignores this gets a 400 rather than a surprise.
   */
  readonly readOnly: boolean

  /**
   * The admin accepts this field on a write and never sends it back.
   *
   * Sent so the interface knows the blank it shows is not the stored value. A
   * password field that looked empty because the record had none would be a
   * different thing entirely.
   */
  readonly writeOnly?: boolean

  /** Present when `kind` is `relation`. */
  readonly relation?: RelationDto
}

/** Which operations a principal may perform on one model. */
export interface ModelPermissionsDto {
  readonly list: boolean
  readonly read: boolean
  readonly create: boolean
  readonly update: boolean
  readonly delete: boolean
}

/** An application-defined button the interface should draw. */
export interface ActionDto {
  readonly name: string
  readonly label: string
  readonly scope: 'record' | 'list'
  /** Ask this before running. Absent means run straight away. */
  readonly confirm?: string
  /** Draw it as destructive. */
  readonly danger?: boolean
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

  /**
   * What this principal may do with the model.
   *
   * Sent so the interface can stop offering actions that will be refused. It is
   * a description of the policy's answers, not the enforcement: every request is
   * checked again when it arrives, and a client that ignores this gets a 403
   * rather than access.
   *
   * `metadata` is not among them - a model the principal cannot see is absent
   * from this document entirely.
   */
  readonly can: ModelPermissionsDto

  /**
   * The field whose value a write should send back as its version.
   *
   * Present only when the admin runs with `concurrency: 'optimistic'` and this
   * model has a column recording when a row last changed. The interface does
   * not work it out for itself: a second implementation of the rule would drift
   * from the one that enforces it, and drift here means a guard that quietly
   * stops guarding.
   */
  readonly versionField?: string

  /**
   * Application-defined actions this principal may run.
   *
   * Already filtered by the policy: an action that would be refused is absent,
   * so the interface never draws a button that cannot work.
   */
  readonly actions: readonly ActionDto[]

  /** What to call the model. Absent unless the application said so. */
  readonly label?: string

  /**
   * Which icon to draw beside it in the navigation.
   *
   * One of a closed set the interface knows how to render - see `ModelIcon` in
   * Core. Absent unless the application named one, and absent is a real answer:
   * the same icon repeated down a column is decoration.
   */
  readonly icon?: ModelIcon
}

/**
 * What this principal may do that is not about a model.
 *
 * Sent so the interface knows whether to offer a screen at all. It is not
 * trusted for anything: every route checks again when the request arrives, and
 * withholding a link has never been a permission.
 */
export interface CapabilitiesDto {
  /** True only when this admin has a team screen and this role may open it. */
  readonly manageTeam: boolean
}

export interface MetadataDto {
  readonly models: readonly ModelDto[]
  readonly capabilities: CapabilitiesDto
}

/**
 * The answer when no policy was consulted.
 *
 * Only reachable from a caller that passes no permissions at all, which is the
 * tests and nothing else - the service always supplies them. Permissive is the
 * right default here precisely because it is not the enforcement: the request
 * is checked when it arrives regardless.
 */
const ALL_PERMITTED: ModelPermissionsDto = {
  list: true,
  read: true,
  create: true,
  update: true,
  delete: true,
}

/**
 * The column on the target that points back, for a one-to-many.
 *
 * `undefined` for every other shape: a to-one owns its own column, and a
 * many-to-many has none on either side.
 */
function targetForeignKeyOf(
  field: FieldMetadata,
  models: readonly ModelMetadata[],
): string | undefined {
  if (relationShape(field, models) !== 'one-to-many') return undefined
  return inverseRelationField(field, models)?.relation?.from
}

/**
 * Order the way the application asked, then the way the schema declares.
 *
 * A declared `order` wins; anything without one keeps its schema position,
 * after everything that has one. Sorting on a missing value would otherwise
 * reshuffle the fields nobody configured.
 */
function byOrder<T>(items: readonly T[], orderOf: (item: T) => number | undefined): readonly T[] {
  return [...items]
    .map((item, index) => ({ item, index, order: orderOf(item) }))
    .sort((a, b) => {
      if (a.order === b.order) return a.index - b.index
      if (a.order === undefined) return 1
      if (b.order === undefined) return -1
      return a.order - b.order
    })
    .map((entry) => entry.item)
}

/**
 * The limit a file field should tell the interface about.
 *
 * The field's own when it declares one, the module ceiling otherwise, and
 * nothing at all for a field that is not a file - a size on a text column would
 * be noise in the document.
 */
function maxSizeFor(
  override: { widget?: string; maxSize?: number | string } | undefined,
  ceiling: number | undefined,
): number | undefined {
  if (override?.maxSize !== undefined) return toBytes(override.maxSize)
  if (override?.widget === 'file' || override?.widget === 'image') return ceiling
  return undefined
}

function toFieldDto(
  field: FieldMetadata,
  modelName: string,
  models: readonly ModelMetadata[],
  overrides: ModelOverrides | undefined,
  uploadCeiling?: number,
): FieldDto {
  const override = fieldOverride(overrides, modelName, field.name)

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
    readOnly: isReadOnly(overrides, modelName, field),
    ...(field.writeOnly === true ? { writeOnly: true } : {}),
    ...(override?.label !== undefined ? { label: override.label } : {}),
    ...(override?.widget !== undefined ? { widget: override.widget } : {}),
    // Only meaningful on a file field, and only sent when declared. The
    // defaults that apply when they are absent live on the server, because
    // that is where they are enforced.
    ...(override?.accept !== undefined ? { accept: [...override.accept] } : {}),
    ...(maxSizeFor(override, uploadCeiling) !== undefined
      ? { maxSize: maxSizeFor(override, uploadCeiling) }
      : {}),
    ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
    ...(field.enumValues ? { enumValues: [...field.enumValues] } : {}),
    ...(field.relation
      ? {
          relation: {
            targetModel: field.relation.targetModel,
            cardinality: field.relation.cardinality,
            ...(field.relation.from !== undefined ? { from: field.relation.from } : {}),
            ...(field.relation.to !== undefined ? { to: field.relation.to } : {}),
            ...(relationShape(field, models) !== undefined
              ? { shape: relationShape(field, models) }
              : {}),
            ...(detachBlockedReason(field, models) !== undefined
              ? { detachBlocked: detachBlockedReason(field, models) }
              : {}),
            ...(targetForeignKeyOf(field, models) !== undefined
              ? { targetForeignKey: targetForeignKeyOf(field, models) }
              : {}),
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
export function toMetadataDto(
  models: readonly ModelMetadata[],
  overrides?: ModelOverrides,
  permissions?: ReadonlyMap<string, ModelPermissionsDto>,
  actions?: ReadonlyMap<string, readonly ActionDto[]>,
  capabilities: CapabilitiesDto = { manageTeam: false },
  versionFieldOf: (model: ModelMetadata) => string | undefined = () => undefined,
  /**
   * The upload ceiling, so a file field always carries a limit.
   *
   * Sent even when the field declares nothing: the interface checks a file's
   * size before uploading it, and a field with no limit to check against sends
   * the whole thing and gets a connection error rather than a sentence. The
   * server enforces it again either way.
   */
  uploadCeiling?: number,
): MetadataDto {
  const present = new Set(models.map((model) => model.name))

  return {
    capabilities,
    models: byOrder(models, (model) => overrides?.[model.name]?.order).map((model) => ({
      name: model.name,
      primaryKey: [...model.primaryKey],
      displayField: displayFieldFor(model),
      can: permissions?.get(model.name) ?? ALL_PERMITTED,
      ...(versionFieldOf(model) !== undefined ? { versionField: versionFieldOf(model) } : {}),
      actions: actions?.get(model.name) ?? [],
      ...(overrides?.[model.name]?.label !== undefined
        ? { label: overrides[model.name]?.label }
        : {}),
      ...(overrides?.[model.name]?.icon !== undefined ? { icon: overrides[model.name]?.icon } : {}),
      fields: byOrder(
        model.fields.filter((field) => !field.relation || present.has(field.relation.targetModel)),
        (field) => fieldOverride(overrides, model.name, field.name)?.order,
      ).map((field) => toFieldDto(field, model.name, models, overrides, uploadCeiling)),
    })),
  }
}
