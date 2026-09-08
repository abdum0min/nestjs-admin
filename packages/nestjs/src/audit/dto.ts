/**
 * An entry as the screen receives it.
 *
 * Not the stored shape. Two things are decided here rather than in the
 * interface, because both would otherwise be re-derived per screen and drift:
 * whether an entry can be put back, and the one-line summary that makes a
 * table of them readable without opening each row.
 */
import { irreversibleReason, reversible, type AuditEntry } from '@nest-admin/core'

import type { ActivityDto, ActivityEntryDto } from './contract.js'

export interface AuditChangeDto {
  readonly field: string
  readonly from: unknown
  readonly to: unknown
}

export interface AuditEntryDto {
  readonly id: string
  /** ISO 8601. The interface formats it; the wire carries one shape. */
  readonly at: string
  readonly actor: string
  readonly actorEmail?: string
  readonly action: string
  readonly model: string
  readonly recordId?: string
  readonly recordLabel?: string
  readonly outcome: string
  readonly detail?: string
  readonly undoOf?: string

  /** An array rather than a map, so the order it is drawn in is decided here. */
  readonly changes?: readonly AuditChangeDto[]

  /** One line, for the table. */
  readonly summary: string

  /**
   * Whether this entry could be put back.
   *
   * Structural only, and the interface is told as much: whether this principal
   * may, and whether the record has moved since, are both decided when the
   * undo is attempted - because both can change between drawing the button and
   * pressing it.
   */
  readonly undoable: boolean
  /** Why not, when it is not. Drawn instead of the button. */
  readonly undoableReason?: string
}

/** Past tense, because a log is a list of things that already happened. */
const VERBS: Readonly<Record<string, string>> = {
  create: 'Created',
  update: 'Changed',
  delete: 'Deleted',
  restore: 'Restored',
  action: 'Ran',
  import: 'Imported into',
  export: 'Exported',
  denied: 'Was refused',
  undo: 'Undid',
}

/** How many field names a summary lists before it stops naming them. */
const NAMED_FIELDS = 3

export function toEntryDto(entry: AuditEntry): AuditEntryDto {
  const changes = entry.changes

  return {
    id: entry.id,
    at: entry.at.toISOString(),
    actor: entry.actor.label,
    ...(entry.actor.email === undefined ? {} : { actorEmail: entry.actor.email }),
    action: entry.action,
    model: entry.model,
    ...(entry.recordId === undefined ? {} : { recordId: String(entry.recordId) }),
    ...(entry.recordLabel === undefined ? {} : { recordLabel: entry.recordLabel }),
    outcome: entry.outcome,
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
    ...(entry.undoOf === undefined ? {} : { undoOf: entry.undoOf }),
    ...(changes === undefined
      ? {}
      : {
          changes: Object.entries(changes).map(([field, change]) => ({
            field,
            from: change.from,
            to: change.to,
          })),
        }),
    summary: summarise(entry),
    undoable: reversible(entry),
    ...(reversible(entry) ? {} : { undoableReason: irreversibleReason(entry) }),
  }
}

/**
 * One line that says what happened.
 *
 * "Changed status and title" is worth having where "Update" is not: a table of
 * fifty rows all reading "Update on Post" tells you nothing you could not have
 * guessed, and opening each one to find out is the reason people stop reading
 * audit logs.
 */
function summarise(entry: AuditEntry): string {
  const verb = VERBS[entry.action] ?? entry.action
  const what = entry.recordLabel ?? entry.model

  if (entry.outcome === 'refused') return `${verb} ${what} — refused`
  if (entry.outcome === 'failed') return `${verb} ${what} — failed`

  if (entry.action === 'update' || entry.action === 'undo') {
    const fields = Object.keys(entry.changes ?? {})
    if (fields.length === 0) return `${verb} ${what}`

    const named = fields.slice(0, NAMED_FIELDS).join(', ')
    const rest = fields.length - NAMED_FIELDS

    return `${verb} ${named}${rest > 0 ? ` and ${rest} more` : ''} on ${what}`
  }

  if (entry.action === 'action' || entry.action === 'export' || entry.action === 'import') {
    return entry.detail === undefined ? `${verb} ${what}` : `${verb} ${what} — ${entry.detail}`
  }

  return `${verb} ${what}`
}

/** The dashboard's card: a number, and the last few lines behind it. */
export function toActivity(
  count: number,
  days: number,
  recent: readonly AuditEntry[],
): ActivityDto {
  return {
    count,
    days,
    recent: recent.map((entry): ActivityEntryDto => ({
      id: entry.id,
      at: entry.at.toISOString(),
      actor: entry.actor.label,
      action: entry.action,
      model: entry.model,
      ...(entry.recordId === undefined ? {} : { recordId: String(entry.recordId) }),
      ...(entry.recordLabel === undefined ? {} : { recordLabel: entry.recordLabel }),
      summary: summarise(entry),
    })),
  }
}
