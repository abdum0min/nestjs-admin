/**
 * What happened in this admin, and who did it.
 *
 * ## What it is, and what it is not
 *
 * It records what happened **in this admin**. A script, a migration or a
 * psql session changes the same rows and this will never know. That limit is
 * stated here rather than left to be discovered, because an audit trail people
 * believe is complete when it is not is worse than none: it is used to
 * conclude that nobody touched the record.
 *
 * ## It never records a value the admin would not show
 *
 * The diff is built from the fields the admin exposes, so a `writeOnly`
 * password hash and a `hidden` column are absent from it. Without that rule the
 * audit table becomes the one place in the product where every secret is
 * written down in plain text, kept forever, and read by a screen whose whole
 * purpose is to be browsed.
 *
 * ## Undo is a new write, not a rewind
 *
 * Reversing an entry replays the old values through the ordinary write path -
 * hooks, permissions, validation - and is itself recorded. It refuses when the
 * record has changed since, because writing the old values over somebody
 * else's later edit is not an undo of anything; it is a silent third edit. See
 * {@link AuditChange}.
 */
import type { RecordId } from '../adapter/orm-adapter.js'

/**
 * What was done.
 *
 * A closed list, because the screen has to label each one and a policy has to
 * be able to reason about them. `denied` is here deliberately: an attempt that
 * was refused is usually the most interesting line in the file.
 */
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  /** A soft delete undone - the record came back. */
  | 'restore'
  /** An application action ran. What it did is the application's to know. */
  | 'action'
  | 'import'
  | 'export'
  /** A write the policy refused. Recorded with the reason, never the data. */
  | 'denied'
  /** An earlier entry reversed. Carries the entry it reversed. */
  | 'undo'

/** How it ended. A failure is worth keeping: it is half of a break-in attempt. */
export type AuditOutcome = 'ok' | 'refused' | 'failed'

/**
 * One field, before and after.
 *
 * Both sides are kept because that is what makes an entry readable without the
 * record in front of you - "status: DRAFT → PUBLISHED" says something that
 * "status changed" does not - and because `from` is what an undo writes back
 * while `to` is what it checks the row against first.
 */
export interface AuditChange {
  readonly from: unknown
  readonly to: unknown
}

/** Who did it. */
export interface AuditActor {
  /** The account's id, when the admin owns the login. */
  readonly id?: string
  readonly email?: string
  /** What to show. Never empty: an entry with no name is not an audit entry. */
  readonly label: string
}

/** An entry as it is written. The store supplies the id and may supply the time. */
export interface NewAuditEntry {
  readonly at: Date
  readonly actor: AuditActor
  readonly action: AuditAction
  /** The model, or `'*'` for something that is not about one. */
  readonly model: string
  readonly recordId?: RecordId
  /** The record's display value at the time, so a deleted row still reads. */
  readonly recordLabel?: string

  /**
   * Field by field, for a create, an update or an undo.
   *
   * Absent on a delete unless the whole record was kept - see
   * {@link AdminAuditOptions.keepDeleted}.
   */
  readonly changes?: Readonly<Record<string, AuditChange>>

  /** The action's name, the export's format, the reason for a refusal. */
  readonly detail?: string
  readonly outcome: AuditOutcome

  /** The entry this one reverses. Only on `undo`. */
  readonly undoOf?: string

  readonly ip?: string
  readonly agent?: string
}

export interface AuditEntry extends NewAuditEntry {
  readonly id: string
}

/** What the screen asks for. The same vocabulary the list routes use. */
export interface AuditQuery {
  readonly page?: number
  readonly perPage?: number
  readonly model?: string
  readonly recordId?: RecordId
  readonly action?: AuditAction
  readonly actor?: string
  readonly since?: Date
  /**
   * Models this principal may read.
   *
   * Applied by the store, not by the screen. An audit entry names a model and
   * carries its values, so a role that cannot see `Order` must not be able to
   * read `Order`'s history - the log would otherwise be a way around every
   * permission in the admin, which is a memorable way to lose one.
   */
  readonly models?: readonly string[]
}

export interface AuditPage {
  readonly data: readonly AuditEntry[]
  readonly total: number
  readonly page: number
  readonly perPage: number
}

/**
 * Where the entries go.
 *
 * `record` is the only required member. A store that ships lines to a log
 * aggregator can implement that alone; the screen and the dashboard widget
 * appear only where `list` is implemented too, because offering a history
 * page backed by something that cannot be queried would be a promise the
 * store never made.
 */
export interface AdminAuditStore {
  /**
   * Write one entry.
   *
   * **Failure must not fail the request.** The write it describes has already
   * happened; refusing the response because the log was unavailable would turn
   * an audit outage into an outage. The service logs and carries on, and that
   * choice is stated here so nobody quietly changes it.
   */
  record(entry: NewAuditEntry): Promise<void> | void

  /** Read them back. Absent on a write-only sink; the screen is then absent too. */
  list?(query: AuditQuery): Promise<AuditPage>

  /** One entry, for the undo path. Required whenever `list` is implemented. */
  read?(id: string): Promise<AuditEntry | null>

  /** How many since a moment, for the dashboard. Falls back to `list`. */
  countSince?(since: Date, models?: readonly string[]): Promise<number>
}

export interface AdminAuditOptions {
  readonly store: AdminAuditStore

  /**
   * Keep the whole record when it is deleted, so the delete can be undone.
   *
   * Off by default, and the default is the cautious one: it means the audit
   * table holds a copy of every row anybody ever deleted, for as long as the
   * table is kept. On a model with personal data that is a copy of exactly the
   * thing somebody asked to have removed.
   */
  readonly keepDeleted?: boolean

  /**
   * Record reads as well as writes.
   *
   * Off by default. Every list and every record page would be an entry, which
   * on a busy admin is thousands a day and buries the writes - and the writes
   * are what anybody looks for. Exports are recorded regardless of this,
   * because taking a whole table away is not a read.
   */
  readonly reads?: boolean
}

/**
 * The fields that actually changed, from the admin's point of view.
 *
 * Compared field by field rather than by object identity, and only across the
 * names given - which is how a `writeOnly` column stays out of the log without
 * this function needing to know what one is.
 *
 * Dates are compared by their instant. Two `Date` objects for the same moment
 * are not `===`, and an update that touched nothing would otherwise record
 * every timestamp on the row as having changed.
 */
export function diffRecords(
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Readonly<Record<string, AuditChange>> {
  const changes: Record<string, AuditChange> = {}

  for (const field of fields) {
    const from = before?.[field]
    const to = after[field]
    if (before !== undefined && same(from, to)) continue
    if (before === undefined && (to === undefined || to === null)) continue

    changes[field] = { from: before === undefined ? undefined : plain(from), to: plain(to) }
  }

  return changes
}

function same(one: unknown, other: unknown): boolean {
  if (one instanceof Date || other instanceof Date) return stamp(one) === stamp(other)
  if (one === other) return true

  // A JSON column arrives as an object and is equal when it reads the same.
  if (typeof one === 'object' && typeof other === 'object' && one !== null && other !== null) {
    return JSON.stringify(one) === JSON.stringify(other)
  }

  return false
}

function stamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

/**
 * A value as something that survives being stored and read back.
 *
 * The entry is written as JSON on most stores, so a `Date` has to become a
 * string here rather than at the boundary - otherwise what comes back is a
 * string on one store and a Date on another, and the screen has to know which.
 */
function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  return value
}

/**
 * Is this entry the kind that could be put back?
 *
 * Structural only - it says nothing about whether this principal may, or
 * whether the record has moved since. Both of those are decided when the undo
 * is attempted, because both can change between drawing a button and pressing
 * it.
 */
export function reversible(entry: AuditEntry): boolean {
  if (entry.outcome !== 'ok') return false

  switch (entry.action) {
    case 'update':
    case 'create':
      return entry.changes !== undefined && Object.keys(entry.changes).length > 0
    case 'restore':
      return true
    case 'delete':
      // Only a soft delete, or a hard one whose record was kept.
      return entry.changes !== undefined
    default:
      // An application action ran application code, an import is many writes,
      // and an undo of an undo is just an undo. None of them reverse.
      return false
  }
}

/** Why this entry cannot be put back, for a screen that has to say so. */
export function irreversibleReason(entry: AuditEntry): string | undefined {
  if (reversible(entry)) return undefined

  if (entry.outcome !== 'ok') return 'It did not succeed, so there is nothing to put back.'

  switch (entry.action) {
    case 'action':
      return 'An application action ran code this admin did not write.'
    case 'import':
      return 'An import is many writes. Undo them from the records themselves.'
    case 'export':
    case 'denied':
      return 'Nothing was written.'
    case 'undo':
      return 'Undoing an undo is an edit. Make it on the record.'
    case 'delete':
      return 'The record was removed and none of it was kept - see `keepDeleted`.'
    default:
      return 'Nothing was recorded that could be put back.'
  }
}
