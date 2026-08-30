/**
 * Which models the admin exposes at all.
 *
 * Distinct from resource authorization, and the two answer different questions.
 * A `ResourceSelection` is structural: it decides what the admin *is*, the same
 * for everyone, and a model outside it does not exist as far as the admin is
 * concerned. `AdminResourceAuth` is per-principal: the model exists, and this
 * caller may or may not act on it.
 *
 * That difference is visible in the response. An excluded model answers 404 -
 * there is no such resource - where a denied one answers 403.
 */

export interface ResourceSelection {
  /**
   * When present, only these models are exposed. Everything else is dropped,
   * including models added to the schema later - which is the point: an
   * allow-list does not quietly grow when someone edits the schema.
   */
  readonly include?: readonly string[]

  /**
   * Models removed from the selection, applied after `include`.
   *
   * The usual reason is a table that is not domain data: session stores,
   * migration bookkeeping, queue tables.
   */
  readonly exclude?: readonly string[]
}

/** Anything with a name - `ModelMetadata`, or a test's stand-in for one. */
interface Named {
  readonly name: string
}

/**
 * Apply a selection, preserving the adapter's own order.
 *
 * Order comes from the schema rather than from `include`, so that adding a name
 * to the list does not silently reshuffle the admin. Deciding the order models
 * appear in is a separate feature and is not this option's job.
 */
export function selectModels<T extends Named>(
  models: readonly T[],
  selection?: ResourceSelection,
): readonly T[] {
  if (!selection) return models

  const included = selection.include ? new Set(selection.include) : undefined
  const excluded = new Set(selection.exclude ?? [])

  return models.filter(
    (model) => (included === undefined || included.has(model.name)) && !excluded.has(model.name),
  )
}

/**
 * Names in the selection that no model answers to.
 *
 * Worth reporting rather than ignoring: a typo in `exclude` leaves the model
 * exposed, which is the opposite of what was asked for and is invisible until
 * someone finds the table in the admin. A typo in `include` is louder - the
 * model simply never appears - but has the same cause.
 */
export function unknownSelectionNames<T extends Named>(
  models: readonly T[],
  selection?: ResourceSelection,
): readonly string[] {
  if (!selection) return []

  const known = new Set(models.map((model) => model.name))
  const referenced = [...(selection.include ?? []), ...(selection.exclude ?? [])]

  return [...new Set(referenced.filter((name) => !known.has(name)))]
}
