/**
 * What the admin had to guess, and what it cannot do.
 *
 * This package renders schemas it has never seen, which means guessing: which
 * column names a record, how the two halves of a relation pair up, whether a
 * date is a creation date. Every one of those guesses degrades **silently** when
 * it is wrong - a relation picker full of cuids, a related list missing its
 * Attach button, a model whose row actions all fail. Nothing says why, and the
 * fix is usually one line the reader does not know exists.
 *
 * ## One finding is one problem, not one model
 *
 * The first version reported per model, and against a ten-model schema with
 * optimistic concurrency on it printed the same paragraph eight times with a
 * different name in it. That is one fact - "the guard is not running on eight
 * of your models" - and printing it eight times is how a report becomes a wall
 * nobody reads. A finding now carries the list of subjects it applies to.
 *
 * ## Three severities, with a rule
 *
 * The first version had two and put "no updated-at column" under `broken`,
 * which lit the navigation up with an eight while nothing was failing.
 *
 *   broken   a request fails today, when somebody clicks the thing
 *   warning  nothing fails, but something you asked for is not happening
 *   note     the admin is doing the best it can with this schema
 *
 * The rule is what keeps a third level from being an argument: `broken` is
 * about requests, not about disappointment.
 *
 * ## What it is not
 *
 * It never touches the database. Data quality, missing rows, empty columns,
 * indexes - none of that is here, and the last one is worth naming: indexes are
 * invisible from this side, and guessing about them would be advice that is
 * confidently wrong.
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

/**
 * What to do about a finding.
 *
 * Three kinds, because a fix is not always an option in this package's
 * configuration. The first version only knew about that one and so its most
 * repeated sentence was "no option fixes this" - an apology printed twelve
 * times, when a `@updatedAt` column was the answer all along.
 */
export interface Remedy {
  readonly kind: 'config' | 'schema' | 'option'
  /** What this choice is, in a few words. Choices are offered, not ordered. */
  readonly label: string
  readonly code: string
}

export interface Finding {
  /** Stable, so a client can group or filter without reading prose. */
  readonly code: string
  readonly severity: 'broken' | 'warning' | 'note'
  /** What it applies to: `Post`, or `User.avatarUrl`. Never empty. */
  readonly subjects: readonly string[]
  /** One line, already carrying the count where the count is the point. */
  readonly title: string
  /** What it costs, in terms of something the reader has seen. */
  readonly detail: string
  /** Ways out. Empty only where there genuinely is nothing to do. */
  readonly remedies: readonly Remedy[]
}

export interface DiagnosisInput {
  readonly models: readonly ModelMetadata[]
  readonly overrides: ModelOverrides | undefined
  readonly concurrency: 'last-write-wins' | 'optimistic'
  /** Whether this admin can store an uploaded file at all. */
  readonly storage: boolean
}

const ORDER = { broken: 0, warning: 1, note: 2 } as const

/** Everything a person could act on, worst first. */
export function diagnose(input: DiagnosisInput): readonly Finding[] {
  const checks = [
    keyless,
    unwritableColumns,
    filesWithoutStorage,
    danglingRelations,
    unversioned,
    unreadable,
    unpairedRelations,
    uneditableModels,
    unsearchableModels,
    inertOptions,
    mismatchedWidgets,
    blankDisplayFields,
    withoutCreatedAt,
  ]

  return checks
    .flatMap((check) => check(input) ?? [])
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}

type Check = (input: DiagnosisInput) => Finding | undefined

/** A finding, or nothing when the check found nothing. */
function found(
  subjects: readonly string[],
  finding: Omit<Finding, 'subjects'>,
): Finding | undefined {
  return subjects.length === 0 ? undefined : { ...finding, subjects }
}

const plural = (count: number, one: string, many: string): string =>
  count === 1 ? one : `${count} ${many}`

/* -------------------------------------------------------------------------- */
/* broken: a request fails today                                              */
/* -------------------------------------------------------------------------- */

/** A key the admin cannot address a row by. */
const keyless: Check = ({ models }) => {
  const subjects = models.filter((model) => model.primaryKey.length !== 1).map((m) => m.name)

  return found(subjects, {
    code: 'unaddressable-key',
    severity: 'broken',
    title: `${plural(subjects.length, 'A model has', 'models have')} no single-column primary key`,
    detail:
      'Every route below the list addresses a record by one id, so opening, editing and ' +
      'deleting fail. The list itself works, which is what makes this confusing to run into. ' +
      'Composite keys are described in the metadata and not yet supported by the adapters.',
    remedies: [],
  })
}

/**
 * A required column the admin has no honest way to fill in.
 *
 * `Decimal`, `BigInt` and `Bytes` arrive as `unknown` because they do not
 * round-trip through JSON reliably. The form sends whatever was typed as a
 * string, which Prisma happens to accept for a Decimal and does not for Bytes -
 * so this is reported rather than blocked. Saying "the admin cannot write this"
 * would be wrong for the case that works, and saying nothing would leave the
 * case that fails to be discovered at the database.
 */
const unwritableColumns: Check = ({ models }) => {
  const subjects = models.flatMap((model) =>
    model.fields
      .filter(
        (field) =>
          field.kind === 'unknown' &&
          !field.isList &&
          field.isRequired &&
          !field.isGenerated &&
          field.defaultValue === undefined,
      )
      .map((field) => `${model.name}.${field.name}`),
  )

  return found(subjects, {
    code: 'unwritable-required-column',
    severity: 'broken',
    title: `${plural(subjects.length, 'A required column is', 'required columns are')} a type the admin cannot produce`,
    detail:
      'Decimal, BigInt and Bytes arrive as an unhandled kind, so the form offers a plain text ' +
      'box and sends what was typed as a string. A Decimal usually survives that; Bytes does ' +
      'not. Required and with no default, whether a record can be created at all depends on ' +
      'which of the three it is.',
    remedies: [
      { kind: 'schema', label: 'Give the column a default', code: '@default(0)' },
      {
        kind: 'config',
        label: 'Or set it from a hook and hide it from the form',
        code: 'models: { <Model>: { fields: { <field>: { readOnly: true } } } }',
      },
    ],
  })
}

/** A file field on an admin with nowhere to put a file. */
const filesWithoutStorage: Check = ({ models, overrides, storage }) => {
  if (storage) return undefined

  const subjects = models.flatMap((model) =>
    model.fields
      .filter((field) => {
        const widget = overrides?.[model.name]?.fields?.[field.name]?.widget
        return widget === 'file' || widget === 'image'
      })
      .map((field) => `${model.name}.${field.name}`),
  )

  return found(subjects, {
    code: 'file-field-without-storage',
    severity: 'broken',
    title: `${plural(subjects.length, 'A field takes', 'fields take')} uploads, and files are turned off`,
    detail:
      'The widget is drawn and every upload fails. This is the one finding whose answer can ' +
      'differ between your machine and a deployment, since storage is configured per ' +
      'environment.',
    remedies: [
      { kind: 'option', label: 'Turn files back on', code: '// remove `files: false`' },
      {
        kind: 'config',
        label: 'Or drop the widget',
        code: 'models: { <Model>: { fields: { <field>: { widget: undefined } } } }',
      },
    ],
  })
}

/**
 * A relation pointing at a model this admin does not have.
 *
 * `resources` decided the target is not part of the admin, so the field is
 * removed from the metadata document before any screen sees it - silently. The
 * form loses a picker and nobody is told why.
 */
const danglingRelations: Check = ({ models }) => {
  const present = new Set(models.map((model) => model.name))

  const subjects = models.flatMap((model) =>
    model.fields
      .filter((field) => field.relation && !present.has(field.relation.targetModel))
      .map((field) => `${model.name}.${field.name} → ${field.relation?.targetModel}`),
  )

  return found(subjects, {
    code: 'relation-to-excluded-model',
    severity: 'broken',
    title: `${plural(subjects.length, 'A relation points', 'relations point')} at a model this admin excludes`,
    detail:
      'The field is dropped from the metadata before any screen sees it, so the form has no ' +
      'picker for it and the record page does not mention it. That is the right behaviour for ' +
      'a hidden model and a surprise if the exclusion was a typo.',
    remedies: [
      {
        kind: 'config',
        label: 'Include the target, or exclude this model too',
        code: "resources: { exclude: ['<Model>'] }",
      },
    ],
  })
}

/* -------------------------------------------------------------------------- */
/* warning: nothing fails, but something asked for is not happening           */
/* -------------------------------------------------------------------------- */

/** Models the concurrency guard cannot cover. */
const unversioned: Check = ({ models, concurrency }) => {
  if (concurrency !== 'optimistic') return undefined

  const subjects = models.filter((model) => updatedFieldFor(model) === undefined).map((m) => m.name)

  return found(subjects, {
    code: 'no-version-column',
    severity: 'warning',
    title: `Optimistic concurrency is not running on ${plural(subjects.length, 'one model', 'models')}`,
    detail:
      'The guard compares a column recording when the row last changed, and these models have ' +
      'none - so two people editing the same record still overwrite each other silently. It is ' +
      'on everywhere else, which is what makes the gap easy to miss.',
    remedies: [
      { kind: 'schema', label: 'Add the column', code: 'updatedAt DateTime @updatedAt' },
      {
        kind: 'option',
        label: 'Or stop claiming the guard is on',
        code: "concurrency: 'last-write-wins'",
      },
    ],
  })
}

/**
 * Models whose display field fell back to the primary key.
 *
 * The single most visible symptom in the product: every relation picker, every
 * link from another record and every breadcrumb shows a cuid, and it reads as
 * the admin being broken rather than as a column nobody nominated.
 */
const unreadable: Check = ({ models, overrides }) => {
  const affected = models.filter(
    (model) =>
      overrides?.[model.name]?.displayField === undefined &&
      displayFieldFor(model) === model.primaryKey[0],
  )

  return found(
    affected.map((model) => model.name),
    {
      code: 'display-field-fell-back',
      severity: 'warning',
      title: `${plural(affected.length, 'A model shows', 'models show')} an id where a name should be`,
      detail:
        'Nothing in these models reads as a label, so every relation picker, link and ' +
        'breadcrumb that names one shows its id. Any column is better than a cuid - a code, a ' +
        'status, a date.',
      // One remedy per model, because the column to nominate differs for each -
      // a shared snippet with a placeholder would be a worse answer than the
      // real one this can work out.
      remedies: affected.flatMap((model): readonly Remedy[] => {
        const candidate = model.fields.find(
          (field) =>
            !field.isId &&
            !field.isList &&
            field.relation === undefined &&
            !field.isGenerated &&
            field.kind !== 'unknown',
        )

        return candidate === undefined
          ? []
          : [
              {
                kind: 'config',
                label: `Nominate one for ${model.name}`,
                code: `models: { ${model.name}: { displayField: '${candidate.name}' } }`,
              },
            ]
      }),
    },
  )
}

/** A to-many whose other half could not be found. */
const unpairedRelations: Check = ({ models }) => {
  const subjects = models.flatMap((model) =>
    model.fields
      .filter((field) => field.relation?.cardinality === 'many')
      .filter((field) => inverseRelationField(field, models) === undefined)
      .map((field) => `${model.name}.${field.name}`),
  )

  return found(subjects, {
    code: 'unpaired-relation',
    severity: 'warning',
    title: `${plural(subjects.length, 'A relation', 'relations')} could not be paired with the other half`,
    detail:
      'The related list still loads, but without the shape of the relation the admin will not ' +
      'offer Attach or Detach on it, and cannot build a link to the records belonging to one ' +
      'parent. Usually the other side is hidden, excluded, or named differently on each end.',
    remedies: [],
  })
}

/** A model whose Edit button opens a form with nothing in it. */
const uneditableModels: Check = ({ models, overrides }) => {
  const subjects = models
    .filter((model) =>
      model.fields.every(
        (field) =>
          field.isGenerated ||
          field.isList ||
          field.relation !== undefined ||
          overrides?.[model.name]?.fields?.[field.name]?.readOnly === true ||
          overrides?.[model.name]?.fields?.[field.name]?.hidden === true,
      ),
    )
    .map((model) => model.name)

  return found(subjects, {
    code: 'nothing-to-edit',
    severity: 'warning',
    title: `${plural(subjects.length, 'A model has', 'models have')} no editable field`,
    detail:
      'Every column is generated, a relation, or configured read-only, so Edit opens a form ' +
      'with nothing in it and Save does nothing. Usually a join table, which is worth hiding ' +
      'from the navigation rather than showing as a dead end.',
    remedies: [
      {
        kind: 'config',
        label: 'Keep it out of the admin',
        code: "resources: { exclude: ['<Model>'] }",
      },
    ],
  })
}

/* -------------------------------------------------------------------------- */
/* note: the admin is doing the best it can                                   */
/* -------------------------------------------------------------------------- */

/** Models the free-text search box can never match anything in. */
const unsearchableModels: Check = ({ models }) => {
  const subjects = models
    .filter((model) =>
      model.fields.every(
        (field) =>
          field.kind !== 'string' ||
          field.isList ||
          field.relation !== undefined ||
          // An id is a string and is never what somebody is typing. Nor is a
          // generated one: a cuid is readable characters with no meaning, and
          // matching it is the same as matching nothing.
          field.isId ||
          field.isGenerated,
      ),
    )
    .map((model) => model.name)

  return found(subjects, {
    code: 'nothing-to-search',
    severity: 'note',
    title: `Search finds nothing on ${plural(subjects.length, 'one model', 'models')}`,
    detail:
      'Free text is matched against string columns, and these have none worth matching - so ' +
      'the box is offered, accepts a term and always comes back empty. A filter on a specific ' +
      'column still works.',
    remedies: [],
  })
}

/** Models with no creation date. */
const withoutCreatedAt: Check = ({ models }) => {
  const subjects = models.filter((model) => createdFieldFor(model) === undefined).map((m) => m.name)

  return found(subjects, {
    code: 'no-created-at',
    severity: 'note',
    title: `${plural(subjects.length, 'A model has', 'models have')} no creation date`,
    detail:
      'The dashboard charts records over time from a creation date, so these get a count and ' +
      'no chart, and newest-first ordering has nothing to sort by.',
    remedies: [{ kind: 'schema', label: 'Add one', code: 'createdAt DateTime @default(now())' }],
  })
}

/**
 * Options that are set and do nothing.
 *
 * `accept` and `maxSize` are read only for a file field. Set on anything else
 * they are configuration somebody wrote, believed, and never got - which is
 * worse than not writing it, because it looks handled.
 */
const inertOptions: Check = ({ models, overrides }) => {
  const subjects = models.flatMap((model) =>
    model.fields
      .filter((field) => {
        const override = overrides?.[model.name]?.fields?.[field.name]
        if (!override) return false
        const isFile = override.widget === 'file' || override.widget === 'image'
        return !isFile && (override.accept !== undefined || override.maxSize !== undefined)
      })
      .map((field) => `${model.name}.${field.name}`),
  )

  return found(subjects, {
    code: 'inert-file-options',
    severity: 'note',
    title: `${plural(subjects.length, 'A field has', 'fields have')} upload options and no upload`,
    detail:
      '`accept` and `maxSize` are read only for a file or image widget. Elsewhere they are ' +
      'configuration that was written, believed, and never applied.',
    remedies: [
      {
        kind: 'config',
        label: 'Add the widget the options are for',
        code: "models: { <Model>: { fields: { <field>: { widget: 'image' } } } }",
      },
    ],
  })
}

/** Kinds a widget is meaningful on. Anything else falls back to a plain input. */
const WIDGET_KINDS: Readonly<Record<string, readonly FieldMetadata['kind'][]>> = {
  textarea: ['string'],
  password: ['string'],
  email: ['string'],
  url: ['string'],
  color: ['string'],
  file: ['string'],
  image: ['string'],
  richtext: ['string'],
  json: ['json', 'string'],
}

/** A widget the field's type cannot carry. */
const mismatchedWidgets: Check = ({ models, overrides }) => {
  const subjects = models.flatMap((model) =>
    model.fields
      .filter((field) => {
        const widget = overrides?.[model.name]?.fields?.[field.name]?.widget
        const kinds = widget === undefined ? undefined : WIDGET_KINDS[widget]
        return kinds !== undefined && !kinds.includes(field.kind)
      })
      .map((field) => `${model.name}.${field.name}`),
  )

  return found(subjects, {
    code: 'widget-kind-mismatch',
    severity: 'note',
    title: `${plural(subjects.length, 'A widget does', 'widgets do')} not fit the column`,
    detail:
      'A colour picker on a number, a textarea on a date: the interface falls back to the ' +
      'input the kind deserves and says nothing, so the option reads as applied when it is not.',
    remedies: [],
  })
}

/** A nominated display field that is never sent back. */
const blankDisplayFields: Check = ({ models, overrides }) => {
  const subjects = models
    .filter((model) => {
      const declared = overrides?.[model.name]?.displayField
      if (declared === undefined) return false
      return overrides?.[model.name]?.fields?.[declared]?.writeOnly === true
    })
    .map((model) => model.name)

  return found(subjects, {
    code: 'write-only-display-field',
    severity: 'note',
    title: `${plural(subjects.length, 'A model is', 'models are')} named by a column that is never returned`,
    detail:
      'The display field is marked write-only, so it is accepted on a write and stripped from ' +
      'every read - which means every label built from it is blank.',
    remedies: [
      {
        kind: 'config',
        label: 'Name it by something readable',
        code: "models: { <Model>: { displayField: '<column>' } }",
      },
    ],
  })
}
