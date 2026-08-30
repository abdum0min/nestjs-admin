/**
 * Reading and writing relations from the UI's side.
 *
 * The server sends a record with both halves of a to-one relation on it:
 *
 * ```json
 * { "id": "p1", "title": "…", "authorId": "u1", "author": { "id": "u1", "name": "Ada" } }
 * ```
 *
 * `author` is what a person should see. `authorId` is what a form submits -
 * the API writes relations through the foreign key, not through the nested
 * object. So the two are used in different places, and the metadata is what
 * ties them together.
 */
import type { AdminRecord, FieldDescriptor, ModelDescriptor } from '../api/types.js'

/**
 * The to-one relation this scalar field is the foreign key of, if any.
 *
 * `authorId` on its own is an opaque string, and rendering a text input for it
 * asks a person to paste a cuid. Knowing it belongs to `author` is what lets
 * the form offer a picker instead.
 */
export function relationForForeignKey(
  model: ModelDescriptor,
  fieldName: string,
): FieldDescriptor | undefined {
  return model.fields.find(
    (field) => field.relation?.cardinality === 'one' && field.relation.from === fieldName,
  )
}

/** Every scalar field that is the foreign key of a to-one relation. */
export function foreignKeyNames(model: ModelDescriptor): ReadonlySet<string> {
  const names = new Set<string>()
  for (const field of model.fields) {
    if (field.relation?.cardinality === 'one' && field.relation.from !== undefined) {
      names.add(field.relation.from)
    }
  }
  return names
}

/**
 * The readable label for a related record, and the id to link to.
 *
 * Returns `undefined` when the relation is not set, or when the server did not
 * send the nested object - which happens for a to-many, and for a relation
 * whose target is not part of this admin.
 */
export function relationLink(
  relationField: FieldDescriptor,
  targets: readonly ModelDescriptor[],
  record: AdminRecord,
): { label: string; id: string; model: string } | undefined {
  const related = record[relationField.name]
  if (related === null || related === undefined || typeof related !== 'object') return undefined

  const targetName = relationField.relation?.targetModel
  const target = targets.find((candidate) => candidate.name === targetName)
  if (!target) return undefined

  const values = related as Record<string, unknown>
  const [key] = target.primaryKey
  const id = key === undefined ? undefined : values[key]
  if (id === null || id === undefined) return undefined

  const label = values[target.displayField]

  return {
    // The display field can be null on an optional column. The id is a poor
    // label but an honest one, and it beats rendering "null".
    label: label === null || label === undefined || label === '' ? String(id) : String(label),
    id: String(id),
    model: target.name,
  }
}
