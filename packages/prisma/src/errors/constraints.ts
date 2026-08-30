/**
 * Prisma error codes -> Core constraint errors.
 *
 * Everything here exists so that an ordinary mistake in a form stops being
 * reported as an internal error. Before it, a duplicate email, a foreign key
 * pointing at nothing and a missing required value all came back as
 * "an internal error occurred" - the correct treatment for a broken database
 * and the wrong one for a person who typed the same address twice.
 *
 * ## Codes, not classes
 *
 * Matched by `code` rather than `instanceof PrismaClientKnownRequestError`, for
 * the reason the adapter already gives: importing `@prisma/client` here would
 * load a second copy of a package the consumer owns and tie this package to
 * their Prisma version.
 *
 * ## Field names come from `meta`, and may not be there
 *
 * Prisma reports the columns involved differently per code and per connector,
 * and sometimes not at all - a SQLite unique violation on a composite index
 * names the index rather than the columns. Where a name is missing the error
 * says so in general terms rather than inventing one, because a message that
 * blames the wrong field is worse than one that blames none.
 */
import { ConstraintError, type ConstraintKind } from '@nest-admin/core'

/**
 * Measured against Prisma 7.10.0.
 *
 * `P2014` is the one worth naming: it fires when a *delete* would orphan a
 * required relation, so it is a foreign-key problem arriving from the opposite
 * direction to `P2003`.
 */
const CONSTRAINT_CODES: Readonly<Record<string, ConstraintKind>> = {
  P2002: 'unique',
  P2003: 'foreign-key',
  P2014: 'foreign-key',
  P2011: 'required',
  P2012: 'required',
  P2013: 'required',
}

interface PrismaKnownError {
  readonly code: string
  readonly meta?: Readonly<Record<string, unknown>>
}

function isPrismaKnownError(value: unknown): value is PrismaKnownError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code: unknown }).code === 'string'
  )
}

/**
 * The columns Prisma named, if it named any.
 *
 * The shape differs by code: `target` for a unique violation (a string or an
 * array, depending on the connector), `field_name` for a foreign key,
 * `constraint` for a null violation. Anything unrecognised yields nothing,
 * which the message handles.
 */
function fieldsFrom(meta: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  if (!meta) return []

  // Prisma 7 with a driver adapter nests the connector's own report, and that
  // is the only place the column names appear - `meta.target` is the older,
  // flatter shape and is still what a client without a driver adapter reports.
  // Both are read, because which one arrives depends on how the consumer built
  // their client rather than on anything this package controls.
  const nested = (meta['driverAdapterError'] as { cause?: { constraint?: unknown } } | undefined)
    ?.cause?.constraint

  const candidate =
    (nested as { fields?: unknown } | undefined)?.fields ??
    meta['target'] ??
    meta['field_name'] ??
    meta['constraint']

  if (Array.isArray(candidate)) {
    return candidate.filter((entry): entry is string => typeof entry === 'string')
  }

  if (typeof candidate !== 'string') return []

  // Some connectors report the index name rather than the columns -
  // `User_email_key` for `@unique` on `email`. The column is recoverable from
  // the convention, and a wrong guess here would name a field that does not
  // exist, so it is only trusted when the shape matches exactly.
  const index = /^(.+?)_(.+)_key$/.exec(candidate)
  if (index?.[2] !== undefined) return index[2].split('_')

  return [candidate]
}

/**
 * A missing required argument, which Prisma refuses before the database sees it.
 *
 * It arrives as `PrismaClientValidationError`, which carries **no code** - so
 * it cannot be matched the way every other case here is, and without special
 * handling a form submitted without a required field answers with a generic
 * 500.
 *
 * The message names the arguments in a fixed phrase, and that phrase is all
 * that is read from it. The rest of the text is a rendering of the call site
 * and of the data that was submitted - absolute paths and field values - so
 * forwarding any of it is out of the question.
 */
function missingArguments(cause: unknown): readonly string[] {
  if (!(cause instanceof Error) || cause.constructor.name !== 'PrismaClientValidationError') {
    return []
  }

  const names: string[] = []
  for (const match of cause.message.matchAll(/Argument `([A-Za-z0-9_]+)` is missing/g)) {
    if (match[1] !== undefined) names.push(match[1])
  }

  return names
}

/**
 * A `ConstraintError` when Prisma refused the write for a reason a caller can
 * act on, or `undefined` when it did not.
 */
export function toConstraintError(cause: unknown, model: string): ConstraintError | undefined {
  const missing = missingArguments(cause)
  if (missing.length > 0) return new ConstraintError('required', model, missing)

  if (!isPrismaKnownError(cause)) return undefined

  const constraint = CONSTRAINT_CODES[cause.code]
  if (!constraint) return undefined

  return new ConstraintError(constraint, model, fieldsFrom(cause.meta))
}
