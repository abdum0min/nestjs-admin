/**
 * The record screen, in groups.
 *
 * One function for both halves of it. The read view and the form show
 * different fields - a form has only the writable ones - so each passes in
 * what it is drawing, and this decides how to arrange it. Two implementations
 * would drift, and the drift would be a field appearing under one heading when
 * you read it and another when you edit it.
 *
 * ## Nothing here can hide a field
 *
 * The server resolved the sections already, and appended a final group holding
 * everything no section claimed. This intersects those groups with the fields
 * it was given and drops the ones left empty - so a section of read-only
 * fields disappears from the form rather than rendering as a heading with
 * nothing under it, and every field passed in comes out in exactly one group.
 */
import type { FieldDescriptor, ModelDescriptor } from '../api/types.js'

export interface FieldGroup {
  /** Empty when the model has no configured layout - see `layout: 'flat'`. */
  readonly heading: string
  readonly description?: string
  readonly collapsed?: boolean
  readonly fields: readonly FieldDescriptor[]
}

export interface GroupedFields {
  /** `'flat'` is one group with no heading: what the screen has always shown. */
  readonly layout: 'flat' | 'sections' | 'tabs'
  readonly groups: readonly FieldGroup[]
}

export function fieldGroups(
  model: ModelDescriptor,
  fields: readonly FieldDescriptor[],
): GroupedFields {
  const detail = model.detail

  if (detail === undefined || detail.sections.length === 0) {
    return { layout: 'flat', groups: [{ heading: '', fields }] }
  }

  const byName = new Map(fields.map((field) => [field.name, field]))

  const groups = detail.sections
    .map((section) => ({
      heading: section.heading,
      ...(section.description !== undefined ? { description: section.description } : {}),
      ...(section.collapsed !== undefined ? { collapsed: section.collapsed } : {}),
      fields: section.fields
        .map((name) => byName.get(name))
        .filter((field): field is FieldDescriptor => field !== undefined),
    }))
    .filter((section) => section.fields.length > 0)

  // Every configured section could be empty here - a form whose model groups
  // only generated columns, for instance. One group with no heading is what
  // the screen showed before any of this existed, and is a better answer than
  // a page of nothing.
  if (groups.length === 0) return { layout: 'flat', groups: [{ heading: '', fields }] }

  return { layout: detail.layout, groups }
}

/**
 * Which group holds the first field with a problem.
 *
 * A form that refuses to save while the reason is behind a folded section or
 * an unselected tab is the failure mode of every grouped form ever built. The
 * screen opens that group instead.
 */
export function groupWithError(
  groups: readonly FieldGroup[],
  errors: Readonly<Record<string, string>>,
): number | undefined {
  const at = groups.findIndex((group) => group.fields.some((field) => errors[field.name]))
  return at === -1 ? undefined : at
}

/** How many fields in this group have a problem. Drawn on the tab. */
export function errorCount(group: FieldGroup, errors: Readonly<Record<string, string>>): number {
  return group.fields.filter((field) => errors[field.name] !== undefined).length
}
