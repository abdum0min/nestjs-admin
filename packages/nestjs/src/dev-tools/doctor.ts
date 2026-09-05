/**
 * What the admin had to guess, and what it could not do.
 *
 * This package renders schemas it has never seen, which means guessing: which
 * column names a record, how the two halves of a relation pair up, whether a
 * date is a creation date. Every one of those guesses degrades **silently** when
 * it is wrong - a relation picker full of cuids, a related list missing its
 * Attach button, a model whose row actions all fail. Nothing says why, and the
 * fix is usually one line of configuration the reader does not know exists.
 *
 * So this asks the metadata a different question from the one every screen asks
 * it, and answers with a list.
 *
 * ## What it is not
 *
 * It never touches the database. Data quality, missing rows, empty columns,
 * indexes - none of that is here, and the last one is worth naming: indexes are
 * invisible from this side, and guessing about them would be advice that is
 * confidently wrong. Its inputs are the schema and the configuration, which are
 * the same on a laptop as in production - which is why living behind the
 * developer tools costs nothing.
 *
 * ## Two severities, not three
 *
 * `broken` is something that does not work. `guessed` is something that works
 * with less than it could. A third level invites an argument about which
 * findings belong in the middle, and the argument is more expensive than the
 * precision.
 */
import {
  createdFieldFor,
  displayFieldFor,
  inverseRelationField,
  updatedFieldFor,
  type FieldMetadata,
  type ModelMetadata,
  type ModelOverrides,
} from '@nest-admin/core'

export interface Finding {
  /** Stable, so a client can group or filter without reading prose. */
  readonly code: string
  readonly severity: 'broken' | 'guessed'
  readonly model: string
  readonly field?: string
  /** One line: what is wrong. */
  readonly title: string
  /** What it costs, in terms of something the reader has seen. */
  readonly detail: string
  /**
   * The configuration that fixes it, ready to copy.
   *
   * Absent where no configuration can - a composite key needs a schema change,
   * not an option. A diagnosis nobody can act on is a list of complaints, and
   * pretending an option exists would be worse than saying nothing.
   */
  readonly fix?: string
}

export interface DiagnosisInput {
  readonly models: readonly ModelMetadata[]
  readonly overrides: ModelOverrides | undefined
  readonly concurrency: 'last-write-wins' | 'optimistic'
  /** Whether this admin can store an uploaded file at all. */
  readonly storage: boolean
}

/** Everything a person could act on, worst first. */
export function diagnose(input: DiagnosisInput): readonly Finding[] {
  const findings = input.models.flatMap((model) => [
    ...displayFieldFindings(model, input),
    ...keyFindings(model),
    ...relationFindings(model, input.models),
    ...dateFindings(model, input),
    ...columnFindings(model),
    ...fileFindings(model, input),
  ])

  // Broken first, then in schema order. Someone scanning this list is looking
  // for what is actually failing.
  return [
    ...findings.filter((finding) => finding.severity === 'broken'),
    ...findings.filter((finding) => finding.severity === 'guessed'),
  ]
}

/**
 * A model whose display field fell back to its primary key.
 *
 * `displayFieldFor` ends with the key as an honest last resort, which means
 * every screen that names a record of this model shows a cuid. It is the single
 * most visible symptom in the product and the one most often mistaken for the
 * admin being broken.
 */
function displayFieldFindings(model: ModelMetadata, input: DiagnosisInput): readonly Finding[] {
  if (input.overrides?.[model.name]?.displayField !== undefined) return []

  const chosen = displayFieldFor(model)
  if (chosen !== model.primaryKey[0]) return []

  // Anything a person could read, even if the rule would not have picked it:
  // the rule only considers strings, and a `code` number or a `status` enum is
  // still better than a cuid.
  const candidate = model.fields.find(
    (field) =>
      !field.isId &&
      !field.isList &&
      field.relation === undefined &&
      !field.isGenerated &&
      field.kind !== 'unknown',
  )

  return [
    {
      code: 'display-field-fell-back',
      severity: 'guessed',
      model: model.name,
      title: `${model.name} has no readable column, so its id is shown`,
      detail:
        `Every reference to a ${model.name} - a relation picker, a link from another ` +
        `record, the breadcrumb - shows ${model.primaryKey[0] ?? 'its id'} instead of ` +
        `something a person recognises.`,
      ...(candidate
        ? { fix: `models: { ${model.name}: { displayField: '${candidate.name}' } }` }
        : {}),
    },
  ]
}

/** A key the admin cannot address a row by. */
function keyFindings(model: ModelMetadata): readonly Finding[] {
  if (model.primaryKey.length === 1) return []

  return [
    {
      code: model.primaryKey.length === 0 ? 'no-primary-key' : 'composite-primary-key',
      severity: 'broken',
      model: model.name,
      title:
        model.primaryKey.length === 0
          ? `${model.name} has no primary key`
          : `${model.name} has a composite primary key`,
      detail:
        `Every route below the list addresses a record by a single id, so opening, ` +
        `editing and deleting a ${model.name} all fail. The list itself works. ` +
        `Composite keys are represented in the metadata and not yet supported by the ` +
        `adapters.`,
    },
  ]
}

/**
 * A relation whose other half could not be found.
 *
 * The shape of a to-many - one-to-many or many-to-many - is decided by pairing
 * it with the field on the far side. Unpaired, the admin does not know whether
 * a child can be detached without deleting it, so it offers neither Attach nor
 * Detach, and the link to "everything belonging to this record" cannot be
 * built either.
 */
function relationFindings(
  model: ModelMetadata,
  models: readonly ModelMetadata[],
): readonly Finding[] {
  return model.fields
    .filter((field) => field.relation?.cardinality === 'many')
    .filter((field) => inverseRelationField(field, models) === undefined)
    .map((field) => ({
      code: 'unpaired-relation',
      severity: 'guessed' as const,
      model: model.name,
      field: field.name,
      title: `${model.name}.${field.name} could not be paired with its other half`,
      detail:
        `The related list still loads, but without knowing the shape of the relation the ` +
        `admin will not offer Attach or Detach on it, and cannot build a link to the ` +
        `${field.relation?.targetModel ?? 'target'} records belonging to one ${model.name}. ` +
        `Usually the other side is hidden, excluded, or named differently on each end.`,
    }))
}

/** Dates the admin looks for, and what it cannot do without them. */
function dateFindings(model: ModelMetadata, input: DiagnosisInput): readonly Finding[] {
  const findings: Finding[] = []

  if (createdFieldFor(model) === undefined) {
    findings.push({
      code: 'no-created-at',
      severity: 'guessed',
      model: model.name,
      title: `${model.name} has no creation date`,
      detail:
        `The dashboard builds a chart over time from a creation date, so ${model.name} ` +
        `gets a count and no chart. Newest-first ordering has nothing to sort by either.`,
    })
  }

  if (input.concurrency === 'optimistic' && updatedFieldFor(model) === undefined) {
    findings.push({
      code: 'no-version-column',
      severity: 'broken',
      model: model.name,
      title: `${model.name} cannot be guarded against a lost update`,
      detail:
        `This admin runs with concurrency: 'optimistic', which compares the value of a ` +
        `column recording when the row last changed. ${model.name} has none, so two ` +
        `people editing the same record still overwrite each other silently - the guard ` +
        `is on everywhere except here.`,
    })
  }

  return findings
}

/**
 * Columns the admin has no honest way to edit.
 *
 * `Decimal`, `BigInt` and `Bytes` arrive as `unknown` because they do not
 * round-trip through JSON without losing precision, and the package says so
 * rather than pretending. What it does not yet do is stop the form drawing a
 * text box over one - so a required column of that kind is a create nobody can
 * complete, and an optional one is a box that writes a string where the
 * database wants a number.
 */
function columnFindings(model: ModelMetadata): readonly Finding[] {
  return (
    model.fields
      .filter((field) => field.kind === 'unknown' && !field.isList)
      // A generated one is already read-only everywhere and is never written, so
      // there is nothing to act on. Reporting it would put a finding on every
      // schema with a computed Decimal, and a report that always has entries is
      // one people stop opening.
      .filter((field) => !field.isGenerated)
      .map((field) => ({
        code: 'unsupported-column',
        severity: mustBeSupplied(field) ? ('broken' as const) : ('guessed' as const),
        model: model.name,
        field: field.name,
        title: `${model.name}.${field.name} is a type the admin cannot edit safely`,
        detail: mustBeSupplied(field)
          ? `It is required and has no default, so creating a ${model.name} through the ` +
            `admin cannot produce a value the database will accept. Give the column a ` +
            `default, make it optional, or set it from a hook.`
          : `Decimal, BigInt and Bytes do not survive JSON without losing precision. The ` +
            `value is shown, and writing to it is not something this admin can promise.`,
        fix: `models: { ${model.name}: { fields: { ${field.name}: { readOnly: true } } } }`,
      }))
  )
}

function mustBeSupplied(field: FieldMetadata): boolean {
  return field.isRequired && !field.isGenerated && field.defaultValue === undefined
}

/** A file field on an admin with nowhere to put a file. */
function fileFindings(model: ModelMetadata, input: DiagnosisInput): readonly Finding[] {
  if (input.storage) return []

  return model.fields
    .filter((field) => {
      const widget = input.overrides?.[model.name]?.fields?.[field.name]?.widget
      return widget === 'file' || widget === 'image'
    })
    .map((field) => ({
      code: 'file-field-without-storage',
      severity: 'broken' as const,
      model: model.name,
      field: field.name,
      title: `${model.name}.${field.name} takes uploads, and this admin has nowhere to put them`,
      detail:
        `The widget is drawn and every upload fails, because files are turned off with ` +
        `files: false. This is the one finding that can differ between your machine and ` +
        `a deployment, since storage is configured per environment.`,
      fix: `// remove \`files: false\`, or drop the widget from ${model.name}.${field.name}`,
    }))
}
