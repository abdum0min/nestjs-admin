/**
 * Per-model and per-field configuration.
 *
 * The schema says what a model *is*; this says how the admin should treat it.
 * Two different questions, so they are two different inputs - a column being a
 * string is a fact about the database, and that column being a password is a
 * fact about the application.
 *
 * The overrides divide into two kinds, and the difference matters:
 *
 *   behaviour     `hidden`, `readOnly`, `displayField`. Enforced. A hidden
 *                 field is removed from the metadata every layer reads, so it
 *                 cannot be filtered, sorted, written or returned - see
 *                 `applyOverrides`.
 *
 *   behaviour     `writeOnly` too - accepted on a write and stripped from
 *                 every read.
 *
 *   presentation  `label`, `widget`, `order`. Passed to the client, which is
 *                 free to ignore them. Nothing depends on them being honoured.
 *
 * Anything in the first group that were only presentation would be a security
 * hole with a reassuring name.
 */
import type { FieldMetadata, ModelMetadata } from '../metadata/model.js'

/**
 * How a field should be edited, when its type does not say enough.
 *
 * A `string` column may be a sentence, a password, an address or a colour, and
 * the schema cannot tell them apart. Deliberately a closed list: a client has
 * to know how to render each one, so an open string would mean silently
 * falling back to a plain input and no way to notice.
 */
export type FieldWidget = 'textarea' | 'password' | 'email' | 'url' | 'color' | 'json'

export interface FieldOverride {
  /**
   * Remove the field from the admin entirely.
   *
   * **Enforced, not cosmetic.** The field is dropped from the metadata before
   * anything reads it, so it is absent from the schema document, rejected in
   * filters and sorts, refused in writes, and stripped from every response.
   * A password hash is the reason this exists.
   */
  readonly hidden?: boolean

  /** Show the field, refuse to write it. Generated columns are already this. */
  readonly readOnly?: boolean

  /**
   * Write the field, never read it back. The mirror of `readOnly`.
   *
   * **Enforced, not cosmetic.** The column is left out of the query the adapter
   * makes and out of the projection applied to the result, so it is absent from
   * a list, from a detail page and from the record a write returns - while
   * still being accepted in the write itself.
   *
   * A password is what this is for. `hidden` is the wrong tool: it refuses the
   * field in both directions, so a hidden password column can never be set.
   */
  readonly writeOnly?: boolean

  /** What to call it, when the column name is not what people call the thing. */
  readonly label?: string

  /** How to edit it. See {@link FieldWidget}. */
  readonly widget?: FieldWidget

  /** Where it sits among the others. Lower comes first; unset comes last. */
  readonly order?: number
}

/**
 * Icons a model may be given in the navigation.
 *
 * A closed list, for the same reason `FieldWidget` is one: the interface has to
 * know how to draw each name, so an open string would mean silently rendering
 * nothing and no way to notice. It is also a bundle decision - the icon set has
 * about fifteen hundred entries, and only the ones named here are shipped.
 *
 * Chosen to cover what an admin's resources usually are rather than to be
 * complete. A model with no icon is drawn without one, which is the default and
 * is not a lesser state: identical icons down a column are decoration, and the
 * navigation reads better with none than with thirty of the same shape.
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

export interface ModelOverride {
  /** What to call the model. */
  readonly label?: string

  /**
   * Which icon to show beside it in the navigation.
   *
   * Presentational: the client may ignore it, and nothing depends on it being
   * honoured. See {@link ModelIcon} for why the list is closed.
   */
  readonly icon?: ModelIcon

  /**
   * Which field names a record, overriding what would be detected.
   *
   * The detection rule guesses well on conventional schemas and has no way to
   * know that a `code` column is the one people recognise.
   */
  readonly displayField?: string

  /** Where the model sits in the resource list. Lower first; unset last. */
  readonly order?: number

  readonly fields?: Readonly<Record<string, FieldOverride>>
}

export type ModelOverrides = Readonly<Record<string, ModelOverride>>

/** The override for one field, if the application declared one. */
export function fieldOverride(
  overrides: ModelOverrides | undefined,
  model: string,
  field: string,
): FieldOverride | undefined {
  return overrides?.[model]?.fields?.[field]
}

/** Is this field one the application refuses to write? */
export function isReadOnly(
  overrides: ModelOverrides | undefined,
  model: string,
  field: FieldMetadata,
): boolean {
  // Generated values are read-only whatever the configuration says: they are
  // the database's to produce, and were never writable.
  return field.isGenerated || fieldOverride(overrides, model, field.name)?.readOnly === true
}

/**
 * The models as the admin should see them.
 *
 * Hidden fields are **removed** rather than marked, so that every layer
 * downstream is correct without knowing this option exists. The query parser
 * rejects a filter on a field it cannot find; the metadata mapper cannot
 * describe one; write validation refuses one. A flag would have needed each of
 * those to remember to check it.
 *
 * A declared `displayField` is carried through the same way, so the adapter and
 * the metadata document agree on it without either consulting the config.
 */
export function applyOverrides(
  models: readonly ModelMetadata[],
  overrides: ModelOverrides | undefined,
): readonly ModelMetadata[] {
  if (!overrides) return models

  return models.map((model) => {
    const override = overrides[model.name]
    if (!override) return model

    const hidden = new Set(
      Object.entries(override.fields ?? {})
        .filter(([, field]) => field.hidden === true)
        .map(([name]) => name),
    )

    const writeOnly = new Set(
      Object.entries(override.fields ?? {})
        .filter(([, field]) => field.writeOnly === true)
        .map(([name]) => name),
    )

    const kept = hidden.size === 0 ? model.fields : model.fields.filter((f) => !hidden.has(f.name))

    return {
      ...model,
      ...(override.displayField !== undefined ? { displayField: override.displayField } : {}),
      // Carried onto the metadata rather than looked up again later, so
      // everything downstream - the field scope, the projection, the DTO -
      // reads one flag instead of each re-deriving it from the configuration.
      fields:
        writeOnly.size === 0
          ? kept
          : kept.map((field) =>
              writeOnly.has(field.name) ? { ...field, writeOnly: true } : field,
            ),
    }
  })
}

/**
 * Names in the configuration that no model or field answers to.
 *
 * Reported so a typo fails at startup. The cost of ignoring one is not
 * symmetrical: a mistyped `label` is invisible and harmless, but a mistyped
 * `passwordHash` leaves the real column exposed while the configuration looks
 * like it is protecting it.
 */
export function unknownOverrideNames(
  models: readonly ModelMetadata[],
  overrides: ModelOverrides | undefined,
): readonly string[] {
  if (!overrides) return []

  const unknown: string[] = []

  for (const [modelName, override] of Object.entries(overrides)) {
    const model = models.find((candidate) => candidate.name === modelName)
    if (!model) {
      unknown.push(modelName)
      continue
    }

    const names = new Set(model.fields.map((field) => field.name))

    if (override.displayField !== undefined && !names.has(override.displayField)) {
      unknown.push(`${modelName}.${override.displayField}`)
    }

    for (const fieldName of Object.keys(override.fields ?? {})) {
      if (!names.has(fieldName)) unknown.push(`${modelName}.${fieldName}`)
    }
  }

  return unknown
}

/**
 * Hidden fields that make creating a record impossible.
 *
 * A column that is required, is not produced by the database, and has no
 * default is a value the *caller* must supply. Hiding it removes the only way
 * to supply it, so every create fails - and fails in the database, as a
 * constraint violation the admin can only report as an internal error.
 *
 * Reported at startup for that reason: the configuration is self-defeating, and
 * the symptom otherwise appears far from the cause.
 */
export function unwritableHiddenFields(
  models: readonly ModelMetadata[],
  overrides: ModelOverrides | undefined,
): readonly string[] {
  if (!overrides) return []

  const blocked: string[] = []

  for (const [modelName, override] of Object.entries(overrides)) {
    const model = models.find((candidate) => candidate.name === modelName)
    if (!model) continue

    for (const [fieldName, field] of Object.entries(override.fields ?? {})) {
      if (field.hidden !== true) continue

      const declared = model.fields.find((candidate) => candidate.name === fieldName)
      if (!declared) continue

      if (declared.isRequired && !declared.isGenerated && declared.defaultValue === undefined) {
        blocked.push(`${modelName}.${fieldName}`)
      }
    }
  }

  return blocked
}
