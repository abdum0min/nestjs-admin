/**
 * Coordinates admin operations between the HTTP layer and the ORM adapter.
 *
 * It speaks Core vocabulary only. It has no idea which ORM is underneath, and
 * it must stay that way: this is the layer that would otherwise accumulate
 * "just this once" ORM-specific branches.
 *
 * It is also the **single** resource-authorization boundary. The controller
 * stays thin, the metadata mapper stays a mapper, and the adapter stays
 * authorization-agnostic - so there is exactly one place to read to know what
 * is enforced, and exactly one place a mistake can hide.
 */
import {
  applyOverrides,
  ConflictError,
  detachBlockedReason,
  FieldNotFoundError,
  ForbiddenError,
  InvalidQueryError,
  isNestAdminError,
  isReadOnly,
  ModelNotFoundError,
  updatedFieldFor,
  RecordNotFoundError,
  type DeletedView,
  type ListQuery,
  type FieldMetadata,
  type FilterRule,
  type ModelMetadata,
  type OrmAdapter,
  type Page,
  type RecordData,
  type RecordId,
  type ModelOverrides,
  type ResourceSelection,
  selectModels,
  softDeleteFieldOf,
  unknownOverrideNames,
  unknownSelectionNames,
  unusablePlaceholders,
  unusableSoftDeleteFields,
  unwritableHiddenFields,
} from '@nest-admin/core'
import {
  Inject,
  Injectable,
  Logger,
  type ExecutionContext,
  type OnModuleInit,
} from '@nestjs/common'

import { builtInRuntimeOf } from '../auth/built-in.js'
import { buildDashboard, type DashboardDto } from '../dashboard/service.js'
import type { AdminDashboard } from '../dashboard/contract.js'
import type { AdminAuth } from '../auth/contract.js'
import { readDecision, type AdminOperation, type AdminResourceAuth } from '../auth/resource.js'
import type { AdminCapability } from '../auth/roles.js'
import { clientMessage } from '../http/exception.filter.js'
import { parseDeletedView, parseListQuery, type RawQuery } from '../http/query-parser.js'
import type { AdminActionResult, AdminActionsByModel } from '../actions/contract.js'
import type { AdminHooksByModel } from '../hooks/contract.js'
import {
  ADMIN_ACTIONS,
  ADMIN_ADAPTER,
  ADMIN_AUTH,
  ADMIN_CAPABILITIES,
  ADMIN_CONCURRENCY,
  ADMIN_DASHBOARD,
  ADMIN_DEV_TOOLS,
  ADMIN_FILES,
  ADMIN_TEAM,
  ADMIN_HOOKS,
  ADMIN_MODELS,
  ADMIN_RESOURCE_AUTH,
  ADMIN_RESOURCES,
} from '../tokens.js'
import {
  toMetadataDto,
  type ActionDto,
  type MetadataDto,
  type ModelPermissionsDto,
} from './metadata.dto.js'

/**
 * How many records one bulk delete may name.
 *
 * Not a performance limit - it is a blast-radius limit. The loop below issues
 * one statement per record and runs every hook, so a request naming fifty
 * thousand ids would hold a connection for minutes and be unstoppable halfway
 * through. Two hundred is more than anyone selects by hand and small enough to
 * finish.
 */
/** The fields a response may carry. Excludes anything marked write-only. */
/**
 * A timestamp as one comparable string.
 *
 * The stored value is a `Date`; the one that came back from a client is the
 * ISO string it was serialised to. Comparing them directly always differs, so
 * both go through `Date` - and anything that is not a date compares as itself,
 * which fails closed rather than passing by accident.
 */
function stamp(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString()
}

function readableFields(model: ModelMetadata): readonly FieldMetadata[] {
  return model.fields.filter((field) => field.writeOnly !== true)
}

export const MAX_BULK_DELETE = 200

/** What happened to each record a bulk delete named. */
export interface BulkDeleteResult {
  readonly deleted: readonly RecordId[]
  /** Records still in place, and why. Messages are already safe to show. */
  readonly failed: readonly { readonly id: RecordId; readonly message: string }[]
}

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @Inject(ADMIN_ADAPTER) private readonly adapter: OrmAdapter,
    @Inject(ADMIN_RESOURCE_AUTH) private readonly resourceAuth: AdminResourceAuth,
    @Inject(ADMIN_RESOURCES) private readonly resources: ResourceSelection | undefined,
    @Inject(ADMIN_MODELS) private readonly overrides: ModelOverrides | undefined,
    @Inject(ADMIN_HOOKS) private readonly hooks: AdminHooksByModel | undefined,
    @Inject(ADMIN_ACTIONS) private readonly actions: AdminActionsByModel | undefined,
    @Inject(ADMIN_AUTH) private readonly auth: AdminAuth,
    @Inject(ADMIN_DASHBOARD) private readonly dashboard: AdminDashboard | undefined,
    // Both optional: an admin without a built-in login has no team screen, and
    // one without roles gives every administrator every capability.
    @Inject(ADMIN_TEAM) private readonly team: unknown,
    @Inject(ADMIN_FILES) private readonly files: unknown,
    // Present only when the application imported the dev-tools entrypoint.
    @Inject(ADMIN_DEV_TOOLS) private readonly devTools: unknown,
    @Inject(ADMIN_CAPABILITIES)
    private readonly can: (context: ExecutionContext, capability: AdminCapability) => boolean,
    @Inject(ADMIN_CONCURRENCY)
    private readonly concurrency: 'last-write-wins' | 'optimistic',
  ) {}

  private readonly logger = new Logger('NestAdmin')

  /**
   * Fail at boot on a selection that names a model the schema does not have.
   *
   * A typo in `exclude` leaves the model exposed - the opposite of what was
   * asked for, and invisible until someone finds the table in the admin. It
   * cannot be checked in `forRoot`, because the model list comes from the
   * adapter and asking for it is asynchronous; this is the first moment it can
   * be known, and it is still before the first request.
   */
  async onModuleInit(): Promise<void> {
    const schema = await this.adapter.getModels()
    const known = schema.map((model) => model.name)

    const missingResources = unknownSelectionNames(schema, this.resources)
    if (missingResources.length > 0) {
      throw new Error(
        `AdminModule \`resources\` names ${missingResources.length === 1 ? 'a model' : 'models'} ` +
          `that the schema does not have: ${missingResources.join(', ')}. ` +
          `Known models: ${known.join(', ')}.`,
      )
    }

    // Checked against the *selected* models, so `models: { Session: … }` on a
    // model that `resources` excluded is reported as unknown rather than
    // silently having no effect.
    const missingOverrides = unknownOverrideNames(
      selectModels(schema, this.resources),
      this.overrides,
    )
    if (missingOverrides.length > 0) {
      throw new Error(
        `AdminModule \`models\` names ${missingOverrides.length === 1 ? 'a model or field' : 'models or fields'} ` +
          `this admin does not have: ${missingOverrides.join(', ')}. ` +
          `A typo in \`hidden\` leaves the real column exposed, so this is an error rather than a warning.`,
      )
    }

    // A required column with no default is a value the caller has to supply, so
    // hiding it means no record can ever be created. The database reports that
    // as a constraint violation, which the admin can only pass on as an
    // internal error - a long way from the line that caused it.
    const exposed = selectModels(schema, this.resources)
    await this.checkBuiltInAuth(exposed)
    this.warnAboutUnversionedModels(exposed)

    // A relative placeholder resolves against whatever hash route is open, so
    // the same value works on one screen and 404s on the next - a default
    // avatar that comes and goes as you navigate.
    const unusable = unusablePlaceholders(this.overrides)
    if (unusable.length > 0) {
      const one = unusable.length === 1
      throw new Error(
        `AdminModule \`models\` gives ${unusable.join(', ')} a \`placeholder\` ` +
          `that ${one ? 'is' : 'are'} neither an absolute URL, a path starting with "/", ` +
          `nor a data:image/ URI. The admin is one hash-routed page, so a relative path ` +
          `resolves differently on every screen. Use "/img/avatar.png" or a full URL.`,
      )
    }

    // A column the admin cannot write `null` into would mark records that can
    // never be restored; one it cannot write a date into falls through to
    // destroying the row, which is the behaviour the option exists to stop.
    const badSoftDelete = unusableSoftDeleteFields(exposed, this.overrides)
    if (badSoftDelete.length > 0) {
      throw new Error(
        `AdminModule \`models\` declares soft delete on a column that cannot carry it: ` +
          `${badSoftDelete.join('; ')}. Use an optional DateTime column the database does ` +
          `not generate, for example \`deletedAt DateTime?\`.`,
      )
    }

    const unwritable = unwritableHiddenFields(selectModels(schema, this.resources), this.overrides)
    if (unwritable.length > 0) {
      const one = unwritable.length === 1
      throw new Error(
        `AdminModule \`models\` hides ${unwritable.join(', ')}, ` +
          `${one ? 'which is a required field' : 'which are required fields'} with no default. ` +
          `Hiding ${one ? 'it' : 'them'} leaves no way to supply a value, so every create would ` +
          `fail. Give the column a default, make it optional, or leave it visible.`,
      )
    }
  }

  /**
   * Two things about the built-in authentication that are only knowable here.
   *
   * Warnings rather than boot failures, and the distinction is deliberate.
   * Both describe a *deployment* that is wrong rather than a configuration
   * that cannot work - and an admin that refuses to start because its account
   * table is empty is an admin nobody can seed, because the seed script
   * imports the module.
   */
  /**
   * Name the models optimistic concurrency cannot protect.
   *
   * Said once, at startup, because the alternative is a guard that quietly does
   * nothing on half a schema - which is the failure mode of every safety check
   * nobody can see. A model with no updated-at column keeps the old behaviour,
   * and now the person who turned the option on knows which ones.
   */
  private warnAboutUnversionedModels(exposed: readonly ModelMetadata[]): void {
    if (this.concurrency !== 'optimistic') return

    const unversioned = exposed
      .filter((model) => updatedFieldFor(model) === undefined)
      .map((model) => model.name)

    if (unversioned.length === 0) return

    new Logger('NestAdmin').warn(
      `concurrency: 'optimistic' cannot protect ${unversioned.join(', ')} - ` +
        'no column recording when a row last changed. Edits to those models ' +
        'still overwrite each other silently.',
    )
  }

  private async checkBuiltInAuth(exposed: readonly ModelMetadata[]): Promise<void> {
    const runtime = builtInRuntimeOf(this.auth)
    if (!runtime) return

    /*
     * An account model that is also an editable resource.
     *
     * Anyone who may edit it can set another account’s password hash, or
     * clear `disabled` on their own - which is every permission the admin has,
     * reachable from a table that looks like any other.
     */
    const accountModel = runtime.store.describes
    if (accountModel !== undefined && exposed.some((model) => model.name === accountModel)) {
      this.logger.warn(
        `AdminModule exposes "${accountModel}" as a resource, and it is also where ` +
          'the admin keeps its own accounts. Anyone who may edit it can grant ' +
          `themselves anything the admin can do. Exclude it with ` +
          `resources: { exclude: ["${accountModel}"] }.`,
      )
    }

    /*
     * No accounts at all.
     *
     * Otherwise the symptom is a login form that rejects every correct
     * password, which reads as a broken build rather than an empty table.
     */
    try {
      if ((await runtime.store.count()) === 0) {
        this.logger.warn(
          'AdminModule is using builtInAuth() and the account store is empty, so ' +
            'nobody can sign in. Create the first account with hashAdminPassword().',
        )
      }
    } catch (cause) {
      // A store that cannot be counted will not answer a login either, and
      // saying so at startup beats finding out at the login form.
      this.logger.warn(`Could not read the admin account store: ${String(cause)}`)
    }
  }

  /**
   * What the dashboard shows this principal.
   *
   * Authorized the way everything else is, and *before* anything is queried: a
   * widget over a model this principal may not list is absent from the
   * document, so a dashboard cannot become a way to count rows of a table
   * nobody would let you open.
   *
   * The exposed model list is passed in rather than looked up again inside, so
   * "which models does this person see" is answered once, here, by the same
   * code that answers it for the metadata document.
   */
  async getDashboard(context: ExecutionContext): Promise<DashboardDto> {
    const models = await this.exposedModels()
    const permitted: ModelMetadata[] = []
    const scopes = new Map<string, readonly FilterRule[]>()

    for (const model of models) {
      // Asked once, and both halves of the answer kept: whether a widget over
      // this model may exist, and which rows it may count. A count that ignored
      // the scope would report a number about records the reader may not open,
      // which is the one thing a scope exists to prevent.
      const decision = await this.decide(context, model.name, 'list')
      if (!decision.allowed) continue

      permitted.push(model)
      if (decision.filters.length > 0) scopes.set(model.name, decision.filters)
    }

    return buildDashboard({
      adapter: this.adapter,
      models: permitted,
      declared: this.dashboard,
      context,
      scopes,
      labels: Object.fromEntries(
        Object.entries(this.overrides ?? {}).map(([name, override]) => [name, override?.label]),
      ),
    })
  }

  /**
   * The public metadata document a frontend renders resources from.
   *
   * Models the principal may not see are filtered out **before** mapping, so a
   * denied model never reaches the DTO at all - not its name, fields, relations,
   * primary key or enum values. The response is not "everything, minus some";
   * it is a description of the schema this principal has.
   */
  async getMetadata(context: ExecutionContext): Promise<MetadataDto> {
    const models = await this.exposedModels()

    const visible: ModelMetadata[] = []
    for (const model of models) {
      if (await this.isVisible(context, model.name)) visible.push(model)
    }

    return toMetadataDto(
      visible,
      this.overrides,
      await this.permissionsFor(context, visible),
      await this.actionsFor(context, visible),
      {
        // Both halves: the deployment has to have a team screen, and this role
        // has to be allowed to open it.
        manageTeam: this.team !== undefined && this.can(context, 'manageTeam'),
        // The same two halves. A build that never imported the dev tools and a
        // role that may not use them are indistinguishable from here, which is
        // what a screen should see: in both cases they are not part of this
        // admin.
        useDevTools: this.devTools !== undefined && this.can(context, 'useDevTools'),
        // One half only: export is always mounted, so this is the role's answer
        // and nothing else.
        exportData: this.can(context, 'exportData'),
      },
      // Only when the guard is on: naming a field the server will ignore would
      // suggest a protection that is not running.
      (model) => (this.concurrency === 'optimistic' ? updatedFieldFor(model) : undefined),
      (this.files as { maxSize?: number } | undefined)?.maxSize,
    )
  }

  /**
   * List records.
   *
   * Metadata is resolved first - it decides whether the model is part of this
   * admin at all - and authorization second, so a denied model still never
   * reaches `adapter.list`. Query parsing needs that metadata anyway: only the
   * schema knows whether `price` should arrive as a number or a string.
   */
  async list(
    context: ExecutionContext,
    model: string,
    rawQuery: RawQuery,
  ): Promise<Page<RecordData>> {
    const metadata = await this.requireModel(model)
    const scope = await this.assertAllowed(context, model, 'list')
    const view = parseDeletedView(rawQuery)

    return this.projectPage(
      metadata,
      await this.adapter.list(
        model,
        this.forView(
          model,
          this.withScope(this.scopeToFields(metadata, parseListQuery(rawQuery, metadata)), scope),
          view,
        ),
      ),
    )
  }

  /**
   * Fetch one record.
   *
   * The adapter returns `null` for a missing record; over HTTP that is a 404,
   * so it is turned into an error here rather than in the controller.
   */
  async findOne(context: ExecutionContext, model: string, id: RecordId): Promise<RecordData> {
    const metadata = await this.requireModel(model)
    const scope = await this.assertAllowed(context, model, 'read')
    return this.project(metadata, await this.readInScope(metadata, id, scope))
  }

  async create(context: ExecutionContext, model: string, data: RecordData): Promise<RecordData> {
    const metadata = await this.requireModel(model)
    await this.assertAllowed(context, model, 'create')
    this.assertWritable(metadata, data)

    const prepared = await this.runBefore(context, metadata, 'beforeCreate', data)
    const created = await this.adapter.create(model, prepared)
    await this.runAfter(context, model, 'afterCreate', { record: created })

    return this.project(metadata, created)
  }

  async update(
    context: ExecutionContext,
    model: string,
    id: RecordId,
    data: RecordData,
    /**
     * The version this write was based on, if the caller sent one.
     *
     * Only consulted under `concurrency: 'optimistic'`. Absent is permitted
     * rather than refused: a script patching one field is not the collision
     * this exists for, and refusing it would break every non-browser caller
     * the moment the option is turned on.
     */
    version?: string,
  ): Promise<RecordData> {
    const metadata = await this.requireModel(model)
    const scope = await this.assertAllowed(context, model, 'update')
    this.assertWritable(metadata, data)

    // Read when either reason needs it, and only once. A hook must never see a
    // record this principal could not reach, and a stale write has to be
    // refused before anything runs.
    const current =
      scope.length > 0 || this.concurrency === 'optimistic'
        ? await this.readInScope(metadata, id, scope)
        : undefined

    if (current !== undefined) this.assertFresh(metadata, current, version)

    const prepared = await this.runBefore(context, metadata, 'beforeUpdate', data, id)
    const updated = await this.adapter.update(model, id, prepared)
    await this.runAfter(context, model, 'afterUpdate', { id, record: updated })

    return this.project(metadata, updated)
  }

  /**
   * Delete several records, and say what happened to each.
   *
   * ## Why this is a loop and not a `deleteMany`
   *
   * The adapter contract has no bulk delete, and giving it one would mean
   * every adapter had to have one. More to the point, hooks are per-record: an
   * application that refuses to delete a pinned post must still refuse it when
   * the post is one of forty checkboxes. A single `deleteMany` would step past
   * every one of those refusals at once, which is the opposite of what a
   * confirmation dialog leads someone to expect.
   *
   * ## Why a partial result is a success
   *
   * Deleting thirty records where two are still referenced is not a failed
   * request - twenty-eight rows are gone, and an error response would say
   * nothing about which. So the response is a 200 carrying both lists, and the
   * interface reports them. Nothing is rolled back, and `§ Known Limitations`
   * says so: this is not a transaction, exactly as hooks are not.
   */
  async deleteMany(
    context: ExecutionContext,
    model: string,
    ids: readonly RecordId[],
    permanent = false,
  ): Promise<BulkDeleteResult> {
    const metadata = await this.requireModel(model)
    // Once, for the operation - not once per record. The permission is to
    // delete records of this model, and it does not change mid-loop.
    const scope = await this.assertAllowed(context, model, 'delete')

    if (ids.length === 0) {
      throw new InvalidQueryError('Deleting records requires a body of the form { "ids": [...] }.')
    }
    if (ids.length > MAX_BULK_DELETE) {
      throw new InvalidQueryError(
        `Refusing to delete ${ids.length} records in one request. The limit is ${MAX_BULK_DELETE}.`,
      )
    }

    const deleted: RecordId[] = []
    const failed: Array<{ id: RecordId; message: string }> = []

    for (const id of ids) {
      try {
        // Per record, unlike the permission: a scope is about *which* rows, so
        // it has to be asked once per row. A refusal becomes one failed entry
        // rather than a failed request, which is what the caller wants when
        // forty checkboxes were ticked.
        if (scope.length > 0) await this.readInScope(metadata, id, scope)
        await this.removeOne(context, model, id, permanent)
        deleted.push(id)
      } catch (cause) {
        // Through the filter's own rule, so a refusal explains itself and an
        // internal failure stays generic. A 200 is not a licence to leak.
        failed.push({ id, message: clientMessage(cause) })
      }
    }

    return { deleted, failed }
  }

  /**
   * Delete one record - or mark it, on a model that keeps its deleted rows.
   *
   * `permanent` is the caller saying "actually remove it", and it is offered
   * in the interface only on a record that is already marked. There is no
   * separate permission for it: whoever may delete a record may finish the
   * job, and inventing a right that nothing else in the configuration mentions
   * would be a permission nobody knows they have to grant.
   */
  async delete(
    context: ExecutionContext,
    model: string,
    id: RecordId,
    permanent = false,
  ): Promise<void> {
    const metadata = await this.requireModel(model)
    const scope = await this.assertAllowed(context, model, 'delete')

    if (scope.length > 0) await this.readInScope(metadata, id, scope)

    await this.removeOne(context, model, id, permanent)
  }

  /**
   * Bring a marked record back.
   *
   * Authorized as `delete`, not as `update`, because that is the operation it
   * undoes. A principal trusted to take a record out of every list is trusted
   * to put it back; one who may only edit records should not be able to
   * resurrect what somebody else decided to remove.
   */
  async restore(context: ExecutionContext, model: string, id: RecordId): Promise<RecordData> {
    const metadata = await this.requireModel(model)
    const scope = await this.assertAllowed(context, model, 'delete')

    const field = this.softDeleteField(model)
    if (field === undefined) {
      throw new InvalidQueryError(
        `"${model}" does not use soft delete, so its deleted records are gone rather than ` +
          `marked. There is nothing to restore.`,
      )
    }

    if (scope.length > 0) await this.readInScope(metadata, id, scope)

    return this.project(metadata, await this.adapter.update(model, id, { [field]: null }))
  }

  /**
   * A page of the records on the far side of a to-many relation.
   *
   * Authorized against **both** models, and the distinction matters. Reading
   * `/User/u1/posts` returns Post records, so a principal who may read a User
   * but not list Posts must not receive them through the back door of a
   * relation. The parent decides whether this record may be opened at all; the
   * target decides whether its records may be listed.
   */
  async listRelated(
    context: ExecutionContext,
    model: string,
    id: RecordId,
    relationField: string,
    rawQuery: RawQuery,
  ): Promise<Page<RecordData>> {
    const parent = await this.requireModel(model)
    const parentScope = await this.assertAllowed(context, model, 'read')

    // The parent has to be reachable before its children are, or a scoped
    // principal could read another tenant's records by asking for them through
    // a parent it may not see.
    if (parentScope.length > 0) await this.readInScope(parent, id, parentScope)

    const target = await this.requireRelationTarget(parent, relationField)
    const targetScope = await this.assertAllowed(context, target.name, 'list')

    // Parsed against the target's metadata: the query describes the records
    // being listed, not the one they hang off.
    return this.projectPage(
      target,
      await this.adapter.listRelated(
        model,
        id,
        relationField,
        // Live records only, with no way to ask otherwise. A deleted child
        // showing under its parent would undo the delete everywhere it
        // mattered; restoring one is done from the target model's own list,
        // which is where the toggle lives.
        this.forView(
          target.name,
          this.withScope(this.scopeToFields(target, parseListQuery(rawQuery, target)), targetScope),
          'live',
        ),
      ),
    )
  }

  /**
   * Link an existing record to this one.
   *
   * Requires `update` on both models. Across a one-to-many the child's foreign
   * key is what actually changes, so permitting this with rights over the
   * parent alone would let someone edit records they cannot otherwise touch.
   */
  async attachRelated(
    context: ExecutionContext,
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
  ): Promise<void> {
    const target = await this.assertMayRelink(context, model, relationField)
    await this.assertAllowed(context, target.name, 'update')

    await this.adapter.attachRelated(model, id, relationField, targetId)
  }

  /**
   * Unlink a record from this one, leaving both in place.
   *
   * Refused up front when the relation cannot be broken - a child whose foreign
   * key is required cannot exist without a parent, so there is nothing to
   * detach it to. Saying so is better than forwarding a constraint violation.
   */
  async detachRelated(
    context: ExecutionContext,
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
  ): Promise<void> {
    const target = await this.assertMayRelink(context, model, relationField)
    await this.assertAllowed(context, target.name, 'update')

    const parent = await this.requireModel(model)
    const field = parent.fields.find((candidate) => candidate.name === relationField)
    const blocked = field ? detachBlockedReason(field, await this.exposedModels()) : undefined
    if (blocked) throw new InvalidQueryError(blocked)

    await this.adapter.detachRelated(model, id, relationField, targetId)
  }

  /** Shared preamble for attach and detach: the parent must be updatable. */
  private async assertMayRelink(
    context: ExecutionContext,
    model: string,
    relationField: string,
  ): Promise<ModelMetadata> {
    const parent = await this.requireModel(model)
    await this.assertAllowed(context, model, 'update')
    return this.requireRelationTarget(parent, relationField)
  }

  /**
   * The model on the far side of a to-many relation field.
   *
   * Resolved through the exposed set, so a relation pointing at a model this
   * admin does not expose reads as an unknown field rather than as a route
   * into it.
   */
  private async requireRelationTarget(
    parent: ModelMetadata,
    relationField: string,
  ): Promise<ModelMetadata> {
    const field = parent.fields.find((candidate) => candidate.name === relationField)

    if (!field?.relation || field.relation.cardinality !== 'many') {
      throw new FieldNotFoundError(
        parent.name,
        relationField,
        'Only a to-many relation can be listed this way.',
      )
    }

    const target = (await this.exposedModels()).find(
      (candidate) => candidate.name === field.relation?.targetModel,
    )
    if (!target) throw new FieldNotFoundError(parent.name, relationField)

    return target
  }

  /**
   * A record as this admin is allowed to return it.
   *
   * A whitelist against the effective metadata, which is what makes `hidden`
   * a guarantee rather than a request. The adapter reads whole rows - it knows
   * nothing about admin configuration - so a hidden column arrives here and is
   * dropped before anything can serialise it.
   *
   * Whitelisting rather than deleting the hidden names also covers a column the
   * adapter reports that the metadata does not describe: if it is not part of
   * this admin, it does not leave it.
   */
  private project(model: ModelMetadata, record: RecordData): RecordData {
    const allowed = new Set(readableFields(model).map((field) => field.name))
    const projected: RecordData = {}

    for (const [key, value] of Object.entries(record)) {
      if (allowed.has(key)) projected[key] = value
    }

    return projected
  }

  /**
   * Tell the adapter which fields this admin exposes.
   *
   * The adapter reads a schema, not a configuration, so without this a hidden
   * column would still be searched by free text, sorted and filtered on, and
   * read from the database - each of them a way to learn a value nobody is
   * meant to see. `project` would still keep it out of the response, but
   * "you cannot read it" is a weaker promise than "it was never fetched".
   */
  /**
   * Which columns the adapter is allowed to return.
   *
   * Not every field the model has: a `writeOnly` one is accepted on a write and
   * must never come back, so it is left out of the query itself rather than
   * removed from the answer afterwards. The projection below removes it a
   * second time, which is deliberate - see `FieldMetadata.writeOnly`.
   */
  private scopeToFields(model: ModelMetadata, query: ListQuery): ListQuery {
    return { ...query, fields: readableFields(model).map((field) => field.name) }
  }

  private projectPage(model: ModelMetadata, page: Page<RecordData>): Page<RecordData> {
    return { ...page, data: page.data.map((record) => this.project(model, record)) }
  }

  /**
   * Reject a write that names a field this admin will not write.
   *
   * The adapter validates too, but against the *schema* - it would accept a
   * hidden or read-only column, because from where it stands those are ordinary
   * writable ones. This is the only layer that knows the difference.
   */
  private assertWritable(model: ModelMetadata, data: RecordData): void {
    for (const key of Object.keys(data)) {
      const field = model.fields.find((candidate) => candidate.name === key)

      // Hidden fields are absent from the metadata, so an attempt to write one
      // is indistinguishable from a typo - which is the intended answer.
      if (!field) throw new FieldNotFoundError(model.name, key)

      if (isReadOnly(this.overrides, model.name, field)) {
        throw new FieldNotFoundError(
          model.name,
          key,
          field.isGenerated
            ? 'This value is produced by the database.'
            : 'This field is configured as read-only.',
        )
      }
    }
  }

  /**
   * What this principal may do with each visible model.
   *
   * Asked of the same policy the requests go through, so the document and the
   * enforcement cannot disagree. A policy that throws `ForbiddenError` is read
   * as a denial, exactly as `isVisible` reads it; anything else it throws is a
   * bug and propagates.
   *
   * Without this the interface offers `New`, `Edit` and `Delete` to a
   * principal for whom every one of them would be refused - a button that
   * exists only to produce a 403 is worse than no button.
   */
  private async permissionsFor(
    context: ExecutionContext,
    models: readonly ModelMetadata[],
  ): Promise<ReadonlyMap<string, ModelPermissionsDto>> {
    const permissions = new Map<string, ModelPermissionsDto>()

    for (const model of models) {
      const permits = async (operation: AdminOperation): Promise<boolean> =>
        this.permits(context, model.name, operation)

      permissions.set(model.name, {
        list: await permits('list'),
        read: await permits('read'),
        create: await permits('create'),
        update: await permits('update'),
        delete: await permits('delete'),
      })
    }

    return permissions
  }

  /**
   * Refuse a write built on a version of the record that no longer exists.
   *
   * The version is whatever the model's updated-at column held when the caller
   * read it. Two people who opened the same record hold the same value; the
   * second to save is holding a stale one - and the form sends every field, so
   * saving it would silently undo the first person's work.
   *
   * Three ways this does nothing, all deliberate:
   *
   *   - the strategy is `last-write-wins`: the caller did not ask for it
   *   - the caller sent no version: a script, not a person in a form
   *   - the model has no updated-at column: warned about at startup, because a
   *     guard nobody can see is not a guard
   */
  private assertFresh(
    model: ModelMetadata,
    current: RecordData,
    version: string | undefined,
  ): void {
    if (this.concurrency !== 'optimistic' || version === undefined) return

    const field = updatedFieldFor(model)
    if (field === undefined) return

    const stored = current[field]
    if (stored === null || stored === undefined) return

    if (stamp(stored) !== stamp(version)) throw new ConflictError(model.name)
  }

  /** The policy's answer for one operation, with a thrown denial read as `false`. */
  private async permits(
    context: ExecutionContext,
    model: string,
    operation: AdminOperation,
  ): Promise<boolean> {
    return (await this.decide(context, model, operation)).allowed
  }

  /**
   * The policy's full answer: whether, and over which rows.
   *
   * The same error handling `permits` has always had - a thrown
   * `ForbiddenError` is a denial, anything else is a bug in the policy and
   * propagates. Kept in one place so the two readings cannot drift.
   */
  private async decide(
    context: ExecutionContext,
    model: string,
    operation: AdminOperation,
  ): Promise<{ allowed: boolean; filters: readonly FilterRule[] }> {
    try {
      return readDecision(await this.resourceAuth.authorize({ context, model, operation }))
    } catch (error) {
      // Not `instanceof`: the policy is the host's, and its `ForbiddenError`
      // may come from a different copy of Core than this one.
      if (isNestAdminError(error) && error.kind === 'forbidden') {
        return { allowed: false, filters: [] }
      }
      throw error
    }
  }

  /**
   * Run a `before` hook, if the model has one.
   *
   * The result is validated again rather than trusted: a hook is application
   * code, and the rule that a hidden or read-only field cannot be written is
   * not one it should be able to step around by accident.
   */
  private async runBefore(
    context: ExecutionContext,
    metadata: ModelMetadata,
    hook: 'beforeCreate' | 'beforeUpdate',
    data: RecordData,
    id?: RecordId,
  ): Promise<RecordData> {
    const handler = this.hooks?.[metadata.name]?.[hook]
    if (!handler) return data

    const result = await (hook === 'beforeCreate'
      ? (handler as (args: never) => RecordData | Promise<RecordData>)({
          context,
          model: metadata.name,
          data,
        } as never)
      : (handler as (args: never) => RecordData | Promise<RecordData>)({
          context,
          model: metadata.name,
          id,
          data,
        } as never))

    this.assertWritable(metadata, result)
    return result
  }

  /**
   * Run an `after` hook, if the model has one.
   *
   * Nothing is rolled back if it throws - the write already happened - so the
   * failure is reported as it is rather than dressed up as a failed write.
   */
  private async runAfter(
    context: ExecutionContext,
    model: string,
    hook: 'afterCreate' | 'afterUpdate' | 'afterDelete',
    args: Record<string, unknown>,
  ): Promise<void> {
    const handler = this.hooks?.[model]?.[hook]
    if (!handler) return

    await (handler as (a: never) => void | Promise<void>)({
      context,
      model,
      ...args,
    } as never)
  }

  /**
   * The actions this principal may run, per model.
   *
   * Filtered by the policy before it reaches the document, so an action that
   * would be refused is simply not there - the interface cannot draw a button
   * for something it was never told about.
   */
  private async actionsFor(
    context: ExecutionContext,
    models: readonly ModelMetadata[],
  ): Promise<ReadonlyMap<string, readonly ActionDto[]>> {
    const byModel = new Map<string, readonly ActionDto[]>()

    for (const model of models) {
      const declared = this.actions?.[model.name] ?? []
      if (declared.length === 0) continue
      if (!(await this.permits(context, model.name, 'action'))) continue

      byModel.set(
        model.name,
        declared.map((action) => ({
          name: action.name,
          label: action.label ?? action.name,
          scope: action.scope,
          ...(action.confirm !== undefined ? { confirm: action.confirm } : {}),
          ...(action.danger !== undefined ? { danger: action.danger } : {}),
        })),
      )
    }

    return byModel
  }

  /**
   * Run one application-defined action.
   *
   * Authorized as `'action'` rather than as the operation it resembles: an
   * action can do anything, so a policy should be able to decide about it on
   * its own terms.
   *
   * A `'record'` action is given the id; a `'list'` one is not, and passing an
   * id to it - or omitting one from a record action - is a request that does
   * not match the action that was declared.
   */
  async runAction(
    context: ExecutionContext,
    model: string,
    name: string,
    id?: RecordId,
  ): Promise<AdminActionResult> {
    const metadata = await this.requireModel(model)
    const scope = await this.assertAllowed(context, model, 'action')

    // An action is application code and can do anything, so a record it should
    // never have been given is the one thing this layer can still prevent.
    if (scope.length > 0 && id !== undefined) await this.readInScope(metadata, id, scope)

    const action = (this.actions?.[model] ?? []).find((candidate) => candidate.name === name)
    if (!action) {
      throw new FieldNotFoundError(model, name, 'No such action.')
    }

    if (action.scope === 'record' && id === undefined) {
      throw new InvalidQueryError(`Action "${name}" applies to one record and needs an id.`)
    }
    if (action.scope === 'list' && id !== undefined) {
      throw new InvalidQueryError(`Action "${name}" applies to the whole model, not to a record.`)
    }

    return (await action.run({ context, model, ...(id === undefined ? {} : { id }) })) ?? {}
  }

  // ------------------------------------------------------- resource policy

  /**
   * Deny the request unless the policy permits this operation on this model.
   *
   * Called before any adapter operation. Both a `false` return and a thrown
   * `ForbiddenError` mean the same thing here, so a host may use whichever
   * reads better. Anything else the policy throws propagates untouched and the
   * exception filter turns it into a generic 500 - a broken policy fails the
   * request rather than quietly allowing it.
   */
  private async assertAllowed(
    context: ExecutionContext,
    model: string,
    operation: AdminOperation,
  ): Promise<readonly FilterRule[]> {
    const decision = readDecision(await this.resourceAuth.authorize({ context, model, operation }))
    if (!decision.allowed) throw new ForbiddenError()
    return decision.filters
  }

  /**
   * Merge a scope into the query the caller asked for.
   *
   * ANDed, and the policy's filters go last so the intent reads correctly in a
   * log. A caller cannot shadow them: there is no filter that removes another.
   */
  private withScope(query: ListQuery, scope: readonly FilterRule[]): ListQuery {
    if (scope.length === 0) return query
    return { ...query, filters: [...(query.filters ?? []), ...scope] }
  }

  /** The column that marks a record deleted on this model, if it has one. */
  private softDeleteField(model: string): string | undefined {
    return softDeleteFieldOf(this.overrides, model)
  }

  /**
   * Narrow a list to live records, to marked ones, or to neither.
   *
   * An ordinary filter on an ordinary column, appended the same way a scope is.
   * The adapters are told nothing about soft delete and never need to be: from
   * their side this is `deletedAt eq null`, which is a question they already
   * knew how to ask.
   *
   * A model with no `softDelete` refuses the parameter rather than ignoring it.
   * Ignoring it would answer a request for the deleted records with the live
   * ones - the wrong rows, reported as success.
   */
  private forView(model: string, query: ListQuery, view: DeletedView): ListQuery {
    const field = this.softDeleteField(model)

    if (field === undefined) {
      if (view === 'live') return query
      throw new InvalidQueryError(
        `"${model}" does not use soft delete, so it has no deleted records. ` +
          `Configure models: { ${model}: { softDelete: '<column>' } } to keep them.`,
      )
    }

    if (view === 'all') return query

    const rule: FilterRule = { field, operator: view === 'live' ? 'eq' : 'ne', value: null }
    return { ...query, filters: [...(query.filters ?? []), rule] }
  }

  /**
   * Remove one record, or mark it.
   *
   * Shared by `delete` and `deleteMany` so the two cannot disagree about what
   * Delete means - which they would, eventually, if each decided for itself.
   *
   * The hooks run either way. From everywhere except the database this *is* a
   * delete: the record leaves every list, and a `beforeDelete` that refuses to
   * let go of a record with unpaid invoices has exactly the same reason to
   * refuse when the row is only being marked.
   */
  private async removeOne(
    context: ExecutionContext,
    model: string,
    id: RecordId,
    permanent: boolean,
  ): Promise<void> {
    const field = permanent ? undefined : this.softDeleteField(model)

    const before = this.hooks?.[model]?.beforeDelete
    if (before) await before({ context, model, id })

    if (field === undefined) await this.adapter.delete(model, id)
    else await this.adapter.update(model, id, { [field]: new Date() })

    await this.runAfter(context, model, 'afterDelete', { id })
  }

  /**
   * Refuse a record the scope does not cover, as though it were not there.
   *
   * **404, not 403.** A 403 confirms that a record with this id exists, which is
   * exactly what a scope conceals - "no such order" and "someone else's order"
   * have to be indistinguishable from outside.
   *
   * The membership test is a query rather than an evaluation of the filters in
   * JavaScript. A second implementation of filter semantics would drift from
   * the adapter's, and drift here means the wrong rows.
   *
   * It costs one extra query, and only when a scope applies. An admin that
   * configures nothing runs exactly the queries it ran before.
   */
  private async assertInScope(
    model: ModelMetadata,
    id: RecordId,
    record: RecordData,
    scope: readonly FilterRule[],
  ): Promise<void> {
    if (scope.length === 0) return

    const key = model.primaryKey[0]
    // No single key means no way to ask the question, and guessing is not an
    // option when the answer decides who sees what.
    if (key === undefined) throw new ForbiddenError()

    // The key is read off the record rather than from the URL, so it is already
    // the type the database uses and needs no coercion.
    const page = await this.adapter.list(model.name, {
      perPage: 1,
      filters: [...scope, { field: key, operator: 'eq', value: record[key] }],
    })

    if (page.data.length === 0) throw new RecordNotFoundError(model.name, id)
  }

  /** Fetch a record, and refuse it unless the scope covers it. */
  private async readInScope(
    model: ModelMetadata,
    id: RecordId,
    scope: readonly FilterRule[],
  ): Promise<RecordData> {
    const record = await this.adapter.findOne(model.name, id)
    if (record === null) throw new RecordNotFoundError(model.name, id)
    await this.assertInScope(model, id, record, scope)
    return record
  }

  /**
   * Is this model visible in the metadata document?
   *
   * Same policy, different consequence. A denial here must **hide** the model
   * rather than fail the request: surfacing a 403 from `GET /admin/meta` would
   * tell the caller that a model they cannot see exists, which is the side
   * channel this whole phase is meant to close.
   *
   * A `ForbiddenError` is therefore caught and read as "not visible". Any other
   * error is rethrown - a bug in the policy must surface as a 500, not silently
   * reshape the schema a client is shown.
   */
  private async isVisible(context: ExecutionContext, model: string): Promise<boolean> {
    try {
      const decision = await this.resourceAuth.authorize({ context, model, operation: 'metadata' })
      return decision !== false
    } catch (error) {
      // Not `instanceof`: the policy is the host application's, and its
      // `ForbiddenError` may come from a different copy of Core than this one.
      if (isNestAdminError(error) && error.kind === 'forbidden') return false
      throw error
    }
  }

  /**
   * The models this admin exposes, after the configured selection.
   *
   * Every path goes through here, so an excluded model is absent from the
   * metadata document and unknown to every route.
   */
  /**
   * The models this admin has, and the boundary that decides who may touch
   * them - for callers outside this class.
   *
   * Two methods rather than a general escape hatch, and they exist for one
   * caller: the developer tools, which write through the adapter rather than
   * through `create` (they are a seeder, not a person) and so would otherwise
   * have to re-implement both. Re-implementing the second one is the part that
   * matters: `resourceAuth` is the single authorization boundary in this
   * package, and a second copy of it is a second place for a mistake to hide.
   */
  async schema(): Promise<readonly ModelMetadata[]> {
    return this.exposedModels()
  }

  /** Throws `ForbiddenError` unless the policy allows it. Returns its row scope. */
  async authorize(
    context: ExecutionContext,
    model: string,
    operation: AdminOperation,
  ): Promise<readonly FilterRule[]> {
    await this.requireModel(model)
    return this.assertAllowed(context, model, operation)
  }

  private async exposedModels(): Promise<readonly ModelMetadata[]> {
    return applyOverrides(
      selectModels(await this.adapter.getModels(), this.resources),
      this.overrides,
    )
  }

  /**
   * Resolve a model name to its metadata, or fail with 404.
   *
   * Called before the policy on every operation, and that order is deliberate.
   * Whether a model exists is structural - the same answer for everyone - so an
   * excluded model answers 404 rather than 403, and does so identically for
   * every principal. Asking the policy first would make a model that is not
   * part of this admin look like one the caller merely lacks access to.
   */

  private async requireModel(model: string): Promise<ModelMetadata> {
    const models = await this.exposedModels()
    const found = models.find((candidate) => candidate.name === model)
    if (!found) {
      throw new ModelNotFoundError(
        model,
        models.map((candidate) => candidate.name),
      )
    }
    return found
  }
}
