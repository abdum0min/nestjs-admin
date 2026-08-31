/**
 * A driver's refusal, as a `ConstraintError`.
 *
 * Drizzle does not normalise driver errors - it is a query builder, and what
 * reaches this code is whatever `better-sqlite3`, `pg` or `mysql2` threw. That
 * is the opposite of Prisma, which turns every one of them into a `P2xxx` code
 * with a `meta` object, and it is the single largest difference between writing
 * these two adapters.
 *
 * So this reads the driver's own report. Codes where the driver provides one;
 * the message only where it does not, and only to recover column names, which
 * are the difference between "that was refused" and "that email is taken".
 *
 * ## Why a wrong guess here is safe
 *
 * The field names only decide where the interface draws the message. Naming no
 * field puts it in a banner over the form, which is the fallback for every
 * shape not recognised below - so an unparsed message degrades to a correct
 * error in a less convenient place, never to a wrong one.
 */
import { ConstraintError, type ConstraintKind } from '@nest-admin/core'

interface DriverError {
  readonly code?: unknown
  readonly message?: unknown
  readonly constraint?: unknown
  readonly column?: unknown
  readonly detail?: unknown
}

function driverErrorOf(cause: unknown): DriverError | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined

  // Drizzle rethrows the driver's error, sometimes wrapped once.
  const error = cause as DriverError & { cause?: unknown }
  const inner = error.cause
  if (typeof error.code !== 'string' && typeof inner === 'object' && inner !== null) {
    return inner as DriverError
  }
  return error
}

/**
 * SQLite reports the kind in the code and the columns in the message:
 *
 *   SQLITE_CONSTRAINT_UNIQUE   "UNIQUE constraint failed: users.email"
 *   SQLITE_CONSTRAINT_NOTNULL  "NOT NULL constraint failed: users.name"
 *   SQLITE_CONSTRAINT_FOREIGNKEY  "FOREIGN KEY constraint failed"
 */
const SQLITE_KINDS: Readonly<Record<string, ConstraintKind>> = {
  SQLITE_CONSTRAINT_UNIQUE: 'unique',
  SQLITE_CONSTRAINT_PRIMARYKEY: 'unique',
  SQLITE_CONSTRAINT_NOTNULL: 'required',
  SQLITE_CONSTRAINT_FOREIGNKEY: 'foreign-key',
  SQLITE_CONSTRAINT_TRIGGER: 'foreign-key',
}

/** Postgres and MySQL both use numeric-ish codes, and both name the constraint. */
const CODE_KINDS: Readonly<Record<string, ConstraintKind>> = {
  // Postgres
  '23505': 'unique',
  '23503': 'foreign-key',
  '23502': 'required',
  // MySQL
  ER_DUP_ENTRY: 'unique',
  ER_NO_REFERENCED_ROW_2: 'foreign-key',
  ER_ROW_IS_REFERENCED_2: 'foreign-key',
  ER_BAD_NULL_ERROR: 'required',
}

/** `users.email` in a SQLite message. Several, for a composite constraint. */
function sqliteColumns(message: string): readonly string[] {
  const listed = /constraint failed: (.+)$/i.exec(message)?.[1]
  if (listed === undefined) return []

  return listed
    .split(',')
    .map((entry) => entry.trim().split('.').at(-1) ?? '')
    .filter((entry) => entry !== '')
}

/**
 * The column a Postgres error is about.
 *
 * `column` is populated for a not-null violation. For a unique violation the
 * column names are only in `detail` - `Key (email)=(a@b.c) already exists.` -
 * and the constraint name is a convention (`users_email_key`) rather than a
 * promise, so it is only trusted when the shape matches exactly.
 */
function postgresColumns(error: DriverError): readonly string[] {
  if (typeof error.column === 'string' && error.column !== '') return [error.column]

  if (typeof error.detail === 'string') {
    const key = /^Key \(([^)]+)\)=/.exec(error.detail)?.[1]
    if (key !== undefined) return key.split(',').map((entry) => entry.trim())
  }

  if (typeof error.constraint === 'string') {
    const index = /^(.+?)_(.+)_(key|pkey|fkey)$/.exec(error.constraint)
    if (index?.[2] !== undefined) return index[2].split('_')
  }

  return []
}

/**
 * Column names in the schema's terms, not the database's.
 *
 * A driver reports SQL column names (`author_id`); every other layer of the
 * admin speaks in the schema's property names (`authorId`). Reporting the
 * former would name a field the form does not have, so the message would land
 * in the banner anyway - and be wrong about which box to look at.
 */
export type ColumnNames = (sqlNames: readonly string[]) => readonly string[]

export function toConstraintError(
  cause: unknown,
  model: string,
  toFieldNames: ColumnNames,
): ConstraintError | undefined {
  const error = driverErrorOf(cause)
  if (error === undefined) return undefined

  const code = typeof error.code === 'string' ? error.code : undefined
  const message = typeof error.message === 'string' ? error.message : ''

  if (code !== undefined && code in SQLITE_KINDS) {
    return new ConstraintError(SQLITE_KINDS[code]!, model, toFieldNames(sqliteColumns(message)))
  }

  if (code !== undefined && code in CODE_KINDS) {
    return new ConstraintError(CODE_KINDS[code]!, model, toFieldNames(postgresColumns(error)))
  }

  // Some SQLite builds report only `SQLITE_CONSTRAINT`; the message still says
  // which kind it was, and it is the only thing left to read.
  if (code === 'SQLITE_CONSTRAINT' || (code === undefined && /constraint failed/i.test(message))) {
    const kind: ConstraintKind = /UNIQUE/i.test(message)
      ? 'unique'
      : /NOT NULL/i.test(message)
        ? 'required'
        : 'foreign-key'
    return new ConstraintError(kind, model, toFieldNames(sqliteColumns(message)))
  }

  return undefined
}
