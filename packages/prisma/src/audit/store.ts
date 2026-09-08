/**
 * The audit trail, in Prisma.
 *
 * ## A model of its own, and one the admin should not expose
 *
 * `AdminAuditEntry` by default, beside `AdminAccount` rather than among the
 * application's own tables. And like the account model it belongs in
 * `resources: { exclude: [...] }`: a log anybody can edit is not a log, and one
 * anybody can delete is worse - the first thing somebody covering their tracks
 * would reach for is the row describing what they did.
 *
 * ## What it stores, and what it deliberately does not
 *
 * The diff arrives already filtered to the fields the admin exposes, so a
 * `writeOnly` password hash never reaches here. This does not re-derive that
 * rule; it stores what it is given. The filtering belongs where the metadata
 * is, which is the service.
 *
 * ## `changes` is one JSON column
 *
 * Rather than a row per field. An entry is read whole or not at all - the
 * screen shows every change together, and the undo path needs all of them or
 * none - so a second table would buy a join and a consistency question in
 * exchange for nothing. It also keeps the migration a consumer has to write
 * down to one model.
 */
import { AdapterError } from '@nest-admin/core'
import type {
  AdminAuditStore,
  AuditEntry,
  AuditPage,
  AuditQuery,
  NewAuditEntry,
} from '@nest-admin/core'

import { resolveDelegate } from '../client/delegate.js'

export interface PrismaAuditStoreOptions {
  /** A constructed Prisma Client - the same one the adapter is given. */
  readonly client: unknown

  /** The model holding the trail. `AdminAuditEntry` by default. */
  readonly model?: string

  /**
   * Column names, where they differ from the defaults.
   *
   * A mapping rather than a required schema, for the reason the account store
   * has one: an application that already keeps an activity table should be able
   * to point this at it.
   */
  readonly fields?: {
    readonly id?: string
    readonly at?: string
    readonly actorId?: string
    readonly actorEmail?: string
    readonly actorLabel?: string
    readonly action?: string
    readonly model?: string
    readonly recordId?: string
    readonly recordLabel?: string
    readonly changes?: string
    readonly detail?: string
    readonly outcome?: string
    readonly undoOf?: string
    readonly ip?: string
    readonly agent?: string
  }
}

const DEFAULTS = {
  id: 'id',
  at: 'at',
  actorId: 'actorId',
  actorEmail: 'actorEmail',
  actorLabel: 'actorLabel',
  action: 'action',
  model: 'model',
  recordId: 'recordId',
  recordLabel: 'recordLabel',
  changes: 'changes',
  detail: 'detail',
  outcome: 'outcome',
  undoOf: 'undoOf',
  ip: 'ip',
  agent: 'agent',
} as const

/** The largest page this will return, whatever was asked for. */
const MAX_PER_PAGE = 100

export function prismaAuditStore(options: PrismaAuditStoreOptions): AdminAuditStore {
  const model = options.model ?? 'AdminAuditEntry'
  const column = { ...DEFAULTS, ...options.fields }

  const delegate = () => resolveDelegate(options.client, model, [model])

  /** The `where` a query means, including the scope it must not escape. */
  const where = (query: AuditQuery): Record<string, unknown> => {
    const clauses: Record<string, unknown> = {}

    if (query.model !== undefined) clauses[column.model] = query.model
    if (query.action !== undefined) clauses[column.action] = query.action
    if (query.recordId !== undefined) clauses[column.recordId] = String(query.recordId)
    if (query.since !== undefined) clauses[column.at] = { gte: query.since }

    if (query.actor !== undefined) {
      clauses['OR'] = [{ [column.actorId]: query.actor }, { [column.actorEmail]: query.actor }]
    }

    /*
     * The scope, and it is not optional where it is given.
     *
     * An entry names a model and carries its values, so a role that cannot see
     * `Order` must not read `Order`'s history - otherwise the log is a way
     * around every permission in the admin. `'*'` is always visible: those are
     * the entries that are not about a model.
     */
    if (query.models !== undefined) {
      clauses[column.model] = { in: [...query.models, '*'] }
    }

    return clauses
  }

  const toEntry = (row: Record<string, unknown>): AuditEntry => {
    const label = String(row[column.actorLabel] ?? 'Unknown')
    const actorId = row[column.actorId]
    const actorEmail = row[column.actorEmail]
    const recordId = row[column.recordId]
    const changes = row[column.changes]

    return {
      id: String(row[column.id]),
      at:
        row[column.at] instanceof Date
          ? (row[column.at] as Date)
          : new Date(String(row[column.at])),
      actor: {
        label,
        ...(actorId === null || actorId === undefined ? {} : { id: String(actorId) }),
        ...(actorEmail === null || actorEmail === undefined ? {} : { email: String(actorEmail) }),
      },
      action: String(row[column.action]) as AuditEntry['action'],
      model: String(row[column.model]),
      ...(recordId === null || recordId === undefined ? {} : { recordId: String(recordId) }),
      ...(row[column.recordLabel] === null || row[column.recordLabel] === undefined
        ? {}
        : { recordLabel: String(row[column.recordLabel]) }),
      ...(changes === null || changes === undefined ? {} : { changes: readChanges(changes) }),
      ...(row[column.detail] === null || row[column.detail] === undefined
        ? {}
        : { detail: String(row[column.detail]) }),
      outcome: String(row[column.outcome] ?? 'ok') as AuditEntry['outcome'],
      ...(row[column.undoOf] === null || row[column.undoOf] === undefined
        ? {}
        : { undoOf: String(row[column.undoOf]) }),
      ...(row[column.ip] === null || row[column.ip] === undefined
        ? {}
        : { ip: String(row[column.ip]) }),
      ...(row[column.agent] === null || row[column.agent] === undefined
        ? {}
        : { agent: String(row[column.agent]) }),
    }
  }

  return {
    async record(entry: NewAuditEntry): Promise<void> {
      await delegate().create({
        data: {
          [column.at]: entry.at,
          [column.actorId]: entry.actor.id ?? null,
          [column.actorEmail]: entry.actor.email ?? null,
          [column.actorLabel]: entry.actor.label,
          [column.action]: entry.action,
          [column.model]: entry.model,
          [column.recordId]: entry.recordId === undefined ? null : String(entry.recordId),
          [column.recordLabel]: entry.recordLabel ?? null,
          // Written as text rather than as a JSON column, so the store works on
          // SQLite as well as on PostgreSQL. One column, one shape, everywhere.
          [column.changes]: entry.changes === undefined ? null : JSON.stringify(entry.changes),
          [column.detail]: entry.detail ?? null,
          [column.outcome]: entry.outcome,
          [column.undoOf]: entry.undoOf ?? null,
          [column.ip]: entry.ip ?? null,
          [column.agent]: entry.agent ?? null,
        },
      })
    },

    async list(query: AuditQuery): Promise<AuditPage> {
      const page = Math.max(1, query.page ?? 1)
      const perPage = Math.min(MAX_PER_PAGE, Math.max(1, query.perPage ?? 25))
      const clauses = where(query)

      const [rows, total] = await Promise.all([
        delegate().findMany({
          where: clauses,
          // Newest first, always. A log read oldest-first is a log nobody reads.
          orderBy: { [column.at]: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
        }),
        delegate().count({ where: clauses }),
      ])

      return {
        data: rows.map((row) => toEntry(row as Record<string, unknown>)),
        total,
        page,
        perPage,
      }
    },

    async read(id: string): Promise<AuditEntry | null> {
      const row = await delegate().findUnique({ where: { [column.id]: id } })
      return row === null || row === undefined ? null : toEntry(row as Record<string, unknown>)
    },

    async countSince(since: Date, models?: readonly string[]): Promise<number> {
      return delegate().count({
        where: where({ since, ...(models === undefined ? {} : { models }) }),
      })
    },
  }
}

/**
 * The stored diff, read back.
 *
 * Text on the way in, so it is text on the way out on every database - except
 * where the column is a real JSON type, in which case Prisma has already
 * parsed it. Both are accepted rather than one being declared correct: the
 * mapping exists so an application can point this at a table it already has.
 *
 * Anything unreadable becomes no changes rather than an exception. A corrupt
 * entry should cost its own diff, not the whole history page.
 */
function readChanges(value: unknown): AuditEntry['changes'] {
  if (typeof value === 'object' && value !== null) {
    return value as AuditEntry['changes']
  }

  try {
    const parsed: unknown = JSON.parse(String(value))
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as AuditEntry['changes'])
      : undefined
  } catch {
    return undefined
  }
}

/** Thrown when the model is missing, so the message names the fix. */
export function assertAuditModel(client: unknown, model = 'AdminAuditEntry'): void {
  try {
    resolveDelegate(client, model, [model])
  } catch {
    throw new AdapterError(
      `prismaAuditStore cannot find a "${model}" model on this Prisma Client. ` +
        `Add it to your schema and run a migration - see docs/configuration.md.`,
    )
  }
}
