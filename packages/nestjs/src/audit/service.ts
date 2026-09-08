/**
 * Recording what happened, and putting it back.
 *
 * ## Inside the write path, not in a hook
 *
 * The hooks already run around every write and already receive the context, so
 * recording from one would have been less code. It would also have put the
 * audit trail inside something the *application* owns: a `beforeUpdate` that
 * throws, returns early, or is simply removed takes the log with it. A trail
 * anybody can switch off by editing their own code is not a trail.
 *
 * ## Writing a line must never fail the request
 *
 * The write it describes has already happened. Refusing the response because
 * the log was unavailable turns an audit outage into an outage, and leaves the
 * caller believing their change did not land when it did. So a failure here is
 * logged and swallowed - loudly, at error level, naming the entry that was
 * lost.
 *
 * ## Undo is a new write
 *
 * It replays the old values through `AdminService.update`, so hooks run and
 * permissions are checked exactly as they are for a form. It is itself
 * recorded. And it **refuses when the record has moved since**: writing the old
 * values over somebody else's later edit is not an undo, it is a silent third
 * edit that discards their work and says "restored".
 */
import {
  ForbiddenError,
  InvalidQueryError,
  RecordNotFoundError,
  diffRecords,
  displayFieldFor,
  irreversibleReason,
  reversible,
  type AdminAuditStore,
  type AuditEntry,
  type AuditPage,
  type AuditQuery,
  type ModelMetadata,
  type NewAuditEntry,
  type RecordData,
  type RecordId,
} from '@nest-admin/core'
import { Inject, Injectable, Logger, type ExecutionContext } from '@nestjs/common'

import { AdminService } from '../admin/service.js'
import type { AdminAuditConfig } from './contract.js'
import { adminAccountOf } from '../auth/built-in.js'
import type { AdminCapability } from '../auth/roles.js'
import { ADMIN_AUDIT, ADMIN_CAPABILITIES, ADMIN_SERVICE } from '../tokens.js'

/** How far back the dashboard counts, when it is not told. */
export const DEFAULT_ACTIVITY_DAYS = 7

@Injectable()
export class AuditService {
  constructor(
    @Inject(ADMIN_SERVICE) private readonly admin: AdminService,
    @Inject(ADMIN_AUDIT) private readonly options: AdminAuditConfig | undefined,
    @Inject(ADMIN_CAPABILITIES)
    private readonly can: (context: ExecutionContext, capability: AdminCapability) => boolean,
  ) {}

  private readonly logger = new Logger('NestAdmin')

  /** Is anything recording? Everything below is inert when not. */
  get enabled(): boolean {
    return this.options !== undefined
  }

  /** Can it be read back, or is the store a one-way sink? */
  get readable(): boolean {
    return this.options?.store.list !== undefined
  }

  /** Whether a hard delete keeps the record, so it can be put back. */
  get keepDeleted(): boolean {
    return this.options?.keepDeleted === true
  }

  /* --------------------------------------------------------------- writing */

  /**
   * Write one line.
   *
   * Deliberately not `async` from the caller's point of view: the write it
   * describes is already done, and making every mutation wait for a second
   * round trip to a log would put the audit store on the critical path of the
   * admin. Failures are reported here and go no further - see the file note.
   */
  record(context: ExecutionContext, entry: Omit<NewAuditEntry, 'at' | 'actor'>): void {
    const store = this.options?.store
    if (store === undefined) return

    const line: NewAuditEntry = {
      at: new Date(),
      actor: this.actor(context),
      ...this.origin(context),
      ...entry,
    }

    void (async () => {
      try {
        await store.record(line)
      } catch (cause) {
        this.logger.error(
          `Could not record an audit entry (${line.action} on ${line.model}): ` +
            `${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
    })()
  }

  /**
   * The fields that changed, as the admin sees them.
   *
   * Built from the metadata rather than from the records, which is the rule
   * that keeps a password hash out of the log: a `writeOnly` column is not in
   * `readableFields`, so it is not in the diff, so it is never written down.
   */
  changesFor(
    model: ModelMetadata,
    before: RecordData | undefined,
    after: RecordData,
  ): Readonly<Record<string, { from: unknown; to: unknown }>> {
    const fields = model.fields
      .filter((field) => field.writeOnly !== true && field.kind !== 'relation')
      /*
       * Generated columns are left out, and this is not tidying.
       *
       * `updatedAt` moves on every write, so it would appear in every entry -
       * "Changed title, status, updatedAt" - and, worse, an undo would try to
       * write it back and be refused, because a value the database produces is
       * read-only. Every undo on a model with a timestamp would have failed.
       */
      .filter((field) => !field.isGenerated)
      .map((field) => field.name)

    return diffRecords(before, after, fields)
  }

  /** What to call a record in the log, so a deleted row still reads as itself. */
  labelFor(model: ModelMetadata, record: RecordData | undefined): string | undefined {
    if (record === undefined) return undefined
    const value = record[displayFieldFor(model)]
    return value === null || value === undefined ? undefined : String(value)
  }

  /* --------------------------------------------------------------- reading */

  /**
   * A page of the trail.
   *
   * Scoped twice over. The capability decides whether this principal may open
   * the screen at all; the model list decides which entries exist for them.
   * The second is the one that matters: an entry carries the values of the
   * record it describes, so a readable log with no scope would be a way to
   * read every model in the admin regardless of the policy.
   */
  async list(context: ExecutionContext, query: AuditQuery): Promise<AuditPage> {
    const store = this.require(context)
    if (store.list === undefined) {
      throw new InvalidQueryError('This admin records an audit trail but cannot read it back.')
    }

    return store.list({ ...query, models: await this.visibleModels(context) })
  }

  async read(context: ExecutionContext, id: string): Promise<AuditEntry> {
    const entry = await this.entry(context, id)
    return entry
  }

  /** How many entries since a moment, for the dashboard. */
  async countSince(context: ExecutionContext, since: Date): Promise<number> {
    const store = this.require(context)
    const models = await this.visibleModels(context)

    if (store.countSince !== undefined) return store.countSince(since, models)
    if (store.list === undefined) return 0

    return (await store.list({ since, models, perPage: 1, page: 1 })).total
  }

  /* ------------------------------------------------------------------ undo */

  /**
   * Put an entry back.
   *
   * Four things have to hold, and each is checked here rather than assumed
   * from the button having been drawn - every one of them can change between
   * drawing it and pressing it.
   */
  async undo(context: ExecutionContext, id: string): Promise<RecordData | null> {
    const entry = await this.entry(context, id)

    if (!reversible(entry)) {
      throw new InvalidQueryError(irreversibleReason(entry) ?? 'This cannot be undone.')
    }

    const recordId = entry.recordId
    if (recordId === undefined) {
      throw new InvalidQueryError('This entry names no record.')
    }

    /*
     * Each action is undone by the operation that is its opposite, rather than
     * by writing values back.
     *
     * A soft delete cannot be undone with an update: the marker column is
     * read-only, deliberately, so that nothing can delete a record by editing a
     * form. Its opposite is Restore, which the admin already has - and which
     * checks the same permission, runs the same hooks and refuses the same
     * out-of-scope rows.
     *
     * The write permission is checked the ordinary way by whichever it calls.
     * Undo is not a privilege of its own: whoever may edit the record may put
     * it back, and whoever may not, may not.
     */
    const marker = this.admin.softDeleteFieldOf(entry.model)

    const result =
      entry.action === 'create'
        ? await this.undoCreate(context, entry, recordId)
        : entry.action === 'delete' && marker !== undefined
          ? await this.undoSoftDelete(context, entry, recordId, marker)
          : entry.action === 'restore' && marker !== undefined
            ? await this.undoRestore(context, entry, recordId)
            : entry.action === 'delete'
              ? await this.undoHardDelete(context, entry)
              : await this.undoWrite(context, entry, recordId)

    this.record(context, {
      action: 'undo',
      model: entry.model,
      recordId,
      ...(entry.recordLabel === undefined ? {} : { recordLabel: entry.recordLabel }),
      ...(entry.changes === undefined ? {} : { changes: reverse(entry.changes) }),
      detail: `Reversed ${article(entry.action)} ${entry.action} by ${entry.actor.label}.`,
      outcome: 'ok',
      undoOf: entry.id,
    })

    return result
  }

  /** A marked record, brought back - which is what Restore is. */
  private async undoSoftDelete(
    context: ExecutionContext,
    entry: AuditEntry,
    recordId: RecordId,
    marker: string,
  ): Promise<RecordData> {
    await this.assertStill(context, entry, recordId, [marker])
    return this.admin.restore(context, entry.model, recordId)
  }

  /** A restore is undone by marking the record again. */
  private async undoRestore(
    context: ExecutionContext,
    entry: AuditEntry,
    recordId: RecordId,
  ): Promise<null> {
    await this.admin.delete(context, entry.model, recordId)
    return null
  }

  /**
   * A record that was removed outright, put back.
   *
   * Only where the application asked for the record to be kept. **It comes back
   * with a new identity**: the primary key is generated and read-only, so this
   * creates a record with the old values rather than the old row. Anything that
   * pointed at it by id still points at nothing, and that is worth knowing
   * before relying on this rather than on soft delete.
   */
  private async undoHardDelete(context: ExecutionContext, entry: AuditEntry): Promise<RecordData> {
    const data: RecordData = {}
    for (const [field, change] of Object.entries(entry.changes ?? {})) data[field] = change.to

    return this.admin.create(context, entry.model, data)
  }

  /** A create is undone by removing what it created. */
  private async undoCreate(
    context: ExecutionContext,
    entry: AuditEntry,
    recordId: RecordId,
  ): Promise<null> {
    await this.admin.delete(context, entry.model, recordId)
    return null
  }

  /**
   * An update, a delete or a restore is undone by writing the old values back.
   *
   * The freshness check is the part that matters. Every field this would write
   * is compared against what the row holds now, and a difference refuses the
   * whole undo rather than overwriting it - because the values recorded as
   * `to` are what the row held immediately after the entry, so anything else
   * means somebody has been here since.
   */
  private async undoWrite(
    context: ExecutionContext,
    entry: AuditEntry,
    recordId: RecordId,
  ): Promise<RecordData> {
    const changes = entry.changes ?? {}
    await this.assertStill(context, entry, recordId, Object.keys(changes))

    /*
     * Only the fields the admin would accept on a form.
     *
     * A hook may have written a column the application marked read-only, and
     * that change is worth recording - but writing it back is refused, so an
     * undo carrying it would fail entirely rather than putting back the three
     * fields it could. What it cannot restore is left alone.
     */
    const data: RecordData = {}
    for (const [field, change] of Object.entries(changes)) {
      if (await this.admin.isWritable(entry.model, field)) data[field] = change.from
    }

    if (Object.keys(data).length === 0) {
      throw new InvalidQueryError(
        'Nothing in this entry can be written back: every field it recorded is read-only.',
      )
    }

    return this.admin.update(context, entry.model, recordId, data)
  }

  /**
   * Refuse when the record no longer holds what this entry left behind.
   *
   * The values recorded as `to` are what the row held immediately after the
   * entry, so anything else means somebody has been here since. Writing the old
   * values over their edit is not an undo of this entry - it is a silent third
   * edit that discards their work and reports success.
   */
  private async assertStill(
    context: ExecutionContext,
    entry: AuditEntry,
    recordId: RecordId,
    fields: readonly string[],
  ): Promise<void> {
    const changes = entry.changes ?? {}
    const current = await this.admin.findOne(context, entry.model, recordId)

    const moved = fields.filter((field) => !equal(current[field], changes[field]?.to))

    if (moved.length > 0) {
      throw new InvalidQueryError(
        `This record has changed since: ${moved.join(', ')} ${moved.length === 1 ? 'is' : 'are'} ` +
          `no longer what this entry left behind. Putting the old values back would ` +
          `discard that change rather than undo this one.`,
      )
    }
  }

  /* --------------------------------------------------------------- details */

  private async entry(context: ExecutionContext, id: string): Promise<AuditEntry> {
    const store = this.require(context)
    if (store.read === undefined) {
      throw new InvalidQueryError('This admin records an audit trail but cannot read it back.')
    }

    const entry = await store.read(id)
    if (entry === null) throw new RecordNotFoundError('audit entry', id)

    // The same scope the list applies. Reading one entry by id must not be a
    // way past the rule that keeps a hidden model's history hidden.
    const visible = await this.visibleModels(context)
    if (entry.model !== '*' && !visible.includes(entry.model)) {
      throw new RecordNotFoundError('audit entry', id)
    }

    return entry
  }

  private require(context: ExecutionContext): AdminAuditStore {
    if (this.options === undefined) {
      throw new InvalidQueryError('This admin does not record an audit trail.')
    }
    if (!this.can(context, 'viewAuditLog')) {
      throw new ForbiddenError('This role may not read the audit trail.')
    }
    return this.options.store
  }

  /** Which models this principal may read, which is the scope on every query. */
  private async visibleModels(context: ExecutionContext): Promise<readonly string[]> {
    const allowed: string[] = []

    for (const model of await this.admin.schema()) {
      try {
        await this.admin.authorize(context, model.name, 'read')
        allowed.push(model.name)
      } catch {
        // Not readable by this principal, so neither is its history.
      }
    }

    return allowed
  }

  /**
   * Who is doing this.
   *
   * The built-in account where the admin owns its login, and the application's
   * own resolver otherwise. Where there is neither - an admin behind somebody
   * else's session with no resolver configured - the entry still gets written,
   * labelled as unknown, because "something changed and we do not know who" is
   * information and dropping the line is not.
   */
  private actor(context: ExecutionContext): NewAuditEntry['actor'] {
    const own = this.options?.actorOf?.(context)
    if (own !== undefined) return own

    const account = adminAccountOf(context)
    if (account === undefined) return { label: 'Unknown' }

    return {
      id: account.id,
      ...(account.email === undefined ? {} : { email: account.email }),
      label: account.name ?? account.email ?? account.id,
    }
  }

  /** Where from, when the transport says. Best effort and never fatal. */
  private origin(context: ExecutionContext): { ip?: string; agent?: string } {
    try {
      const request = context.switchToHttp().getRequest<{
        ip?: string
        headers?: Record<string, string | string[] | undefined>
      }>()

      const agent = request?.headers?.['user-agent']

      return {
        ...(request?.ip === undefined ? {} : { ip: request.ip }),
        ...(agent === undefined ? {} : { agent: String(agent).slice(0, 200) }),
      }
    } catch {
      return {}
    }
  }
}

/** "an update", "a delete". A log people read should read like English. */
function article(action: string): string {
  return /^[aeiou]/.test(action) ? 'an' : 'a'
}

/** The same changes, the other way round - what an undo actually wrote. */
function reverse(
  changes: Readonly<Record<string, { from: unknown; to: unknown }>>,
): Readonly<Record<string, { from: unknown; to: unknown }>> {
  return Object.fromEntries(
    Object.entries(changes).map(([field, change]) => [field, { from: change.to, to: change.from }]),
  )
}

/**
 * Is the row still holding what the entry left behind?
 *
 * Dates by instant and objects by their JSON, for the reason `diffRecords` has:
 * the value went through the store as text and comes back as text, so a strict
 * comparison against a live `Date` would say "changed" on every untouched
 * timestamp and make every undo refuse.
 */
function equal(current: unknown, recorded: unknown): boolean {
  if (current === recorded) return true
  if (current === null || current === undefined) return recorded === null || recorded === undefined

  const one = current instanceof Date ? current.toISOString() : current
  if (one === recorded) return true

  if (typeof one === 'object' || typeof recorded === 'object') {
    return JSON.stringify(one) === JSON.stringify(recorded)
  }

  return String(one) === String(recorded)
}
