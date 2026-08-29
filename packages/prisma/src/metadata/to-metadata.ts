/**
 * DMMF -> Core `ModelMetadata`.
 *
 * The one place Prisma's vocabulary is translated into ours. No DMMF type
 * escapes this module: everything downstream (the adapter, the future HTTP
 * layer, the admin UI) sees only Core shapes.
 *
 * This mapper is deliberately independent of *how* the DMMF was obtained, so
 * it is unaffected by a later switch to a build-time Prisma generator.
 */
import type { FieldKind, FieldMetadata, ModelMetadata } from '@nest-admin/core'
import type * as DMMF from '@prisma/dmmf'

/**
 * Prisma scalar type -> Core field kind.
 *
 * `BigInt`, `Decimal` and `Bytes` are intentionally mapped to `'unknown'`
 * rather than squeezed into `'number'` or `'string'`. They do not round-trip
 * through JSON without losing precision or fidelity, and the MVP has not
 * tested editing them - claiming support we have not verified would be worse
 * than declaring them unhandled. They are still listed, so the admin can show
 * them read-only.
 */
const SCALAR_KINDS: Readonly<Record<string, FieldKind>> = {
  String: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
  DateTime: 'datetime',
  Json: 'json',
}

function toFieldKind(field: DMMF.Field): FieldKind {
  if (field.kind === 'object') return 'relation'
  if (field.kind === 'enum') return 'enum'
  if (field.kind === 'scalar') return SCALAR_KINDS[field.type] ?? 'unknown'
  return 'unknown'
}

/**
 * Is this default produced by the database or the ORM, rather than supplied by
 * the user?
 *
 * Measured against Prisma 7.10.0, DMMF distinguishes the two by *shape*:
 *
 *   @default(cuid())    -> { name: 'cuid', args: [1] }        (object)
 *   @default(now())     -> { name: 'now', args: [] }          (object)
 *   @default(autoincrement()) -> { name: 'autoincrement' }    (object)
 *   @default(dbgenerated(..)) -> { name: 'dbgenerated', ... } (object)
 *   @default(true)      -> true                               (primitive)
 *   @default(0)         -> 0                                  (primitive)
 *   @default("USER")    -> "USER"                             (primitive)
 *
 * So a function default is an object carrying `name`; a literal default is a
 * primitive. Treating "has a default" as "generated" would wrongly lock
 * `active Boolean @default(true)` out of every create form.
 */
function isFunctionDefault(value: unknown): value is { name: string; args?: unknown[] } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'name' in value
}

function toFieldMetadata(
  field: DMMF.Field,
  enums: ReadonlyMap<string, readonly string[]>,
): FieldMetadata {
  const kind = toFieldKind(field)

  // A value the database or ORM supplies: a function default, or @updatedAt.
  const isGenerated = field.isUpdatedAt === true || isFunctionDefault(field.default)

  // A literal default is a pre-fill for the create form, not a generated value.
  const hasLiteralDefault = field.hasDefaultValue === true && !isFunctionDefault(field.default)

  const base = {
    name: field.name,
    kind,
    isId: field.isId === true,
    isRequired: field.isRequired === true,
    isUnique: field.isUnique === true,
    isList: field.isList === true,
    isGenerated,
  } satisfies Omit<FieldMetadata, 'defaultValue' | 'enumValues' | 'relation'>

  return {
    ...base,
    ...(hasLiteralDefault ? { defaultValue: field.default } : {}),
    ...(kind === 'enum' ? { enumValues: enums.get(field.type) ?? [] } : {}),
    ...(kind === 'relation'
      ? {
          relation: {
            targetModel: field.type,
            // Cardinality follows directly from isList - the single attribute
            // the generated Prisma Client does not expose at runtime, which is
            // why metadata comes from the schema rather than the client.
            cardinality: field.isList === true ? ('many' as const) : ('one' as const),
          },
        }
      : {}),
  }
}

/**
 * Field names forming the model's primary key.
 *
 * Prisma expresses a single-column key as `@id` on the field and a composite
 * key as a model-level `@@id`, which DMMF surfaces as `primaryKey.fields`.
 * Both are represented here; the adapter is what limits the MVP to
 * single-column keys.
 */
function toPrimaryKey(model: DMMF.Model): readonly string[] {
  const compositeFields = model.primaryKey?.fields
  if (compositeFields && compositeFields.length > 0) return [...compositeFields]
  return model.fields.filter((field) => field.isId === true).map((field) => field.name)
}

/** Translate a whole DMMF document into Core model metadata. */
export function toModelMetadata(dmmf: DMMF.Document): readonly ModelMetadata[] {
  const enums = new Map<string, readonly string[]>(
    dmmf.datamodel.enums.map((enumType) => [
      enumType.name,
      enumType.values.map((value) => value.name),
    ]),
  )

  return dmmf.datamodel.models.map((model) => ({
    name: model.name,
    primaryKey: toPrimaryKey(model),
    fields: model.fields.map((field) => toFieldMetadata(field, enums)),
  }))
}
