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
  detachBlockedReason,
  FieldNotFoundError,
  ForbiddenError,
  InvalidQueryError,
  isNestAdminError,
  isReadOnly,
  ModelNotFoundError,
  RecordNotFoundError,
  type ListQuery,
  type FieldMetadata,
  type ModelMetadata,
  type OrmAdapter,
  type Page,
  type RecordData,
  type RecordId,
  type ModelOverrides,
  type ResourceSelection,
  selectModels,
  unknownOverrideNames,
  unknownSelectionNames,
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
import type { AdminOperation, AdminResourceAuth } from '../auth/resource.js'
import { clientMessage } from '../http/exception.filter.js'
import { parseListQuery, type RawQuery } from '../http/query-parser.js'
import type { AdminActionResult, AdminActionsByModel } from '../actions/contract.js'
import type { AdminHooksByModel } from '../hooks/contract.js'
import {
  ADMIN_ACTIONS,
  ADMIN_ADAPTER,
  ADMIN_AUTH,
  ADMIN_DASHBOARD,
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
    await this.checkBuiltInAuth(selectModels(schema, this.resources))

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

    for (const model of models) {
      if (await this.permits(context, model.name, 'list')) permitted.push(model)
    }

    return buildDashboard({
      adapter: this.adapter,
      models: permitted,
      declared: this.dashboard,
      context,
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
    await this.assertAllowed(context, model, 'list')
    return this.projectPage(
      metadata,
      await this.adapter.list(
        model,
        this.scopeToFields(metadata, parseListQuery(rawQuery, metadata)),
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
    await this.assertAllowed(context, model, 'read')
    const record = await this.adapter.findOne(model, id)
    if (record === null) throw new RecordNotFoundError(model, id)
    return this.project(metadata, record)
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
  ): Promise<RecordData> {
    const metadata = await this.requireModel(model)
    await this.assertAllowed(context, model, 'update')
    this.assertWritable(metadata, data)

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
  ): Promise<BulkDeleteResult> {
    await this.requireModel(model)
    // Once, for the operation - not once per record. The permission is to
    // delete records of this model, and it does not change mid-loop.
    await this.assertAllowed(context, model, 'delete')

    if (ids.length === 0) {
      throw new InvalidQueryError('Deleting records requires a body of the form { "ids": [...] }.')
    }
    if (ids.length > MAX_BULK_DELETE) {
      throw new InvalidQueryError(
        `Refusing to delete ${ids.length} records in one request. The limit is ${MAX_BULK_DELETE}.`,
      )
    }

    const before = this.hooks?.[model]?.beforeDelete
    const deleted: RecordId[] = []
    const failed: Array<{ id: RecordId; message: string }> = []

    for (const id of ids) {
      try {
        if (before) await before({ context, model, id })
        await this.adapter.delete(model, id)
        await this.runAfter(context, model, 'afterDelete', { id })
        deleted.push(id)
      } catch (cause) {
        // Through the filter's own rule, so a refusal explains itself and an
        // internal failure stays generic. A 200 is not a licence to leak.
        failed.push({ id, message: clientMessage(cause) })
      }
    }

    return { deleted, failed }
  }

  async delete(context: ExecutionContext, model: string, id: RecordId): Promise<void> {
    await this.requireModel(model)
    await this.assertAllowed(context, model, 'delete')

    const before = this.hooks?.[model]?.beforeDelete
    if (before) await before({ context, model, id })

    await this.adapter.delete(model, id)
    await this.runAfter(context, model, 'afterDelete', { id })
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
    await this.assertAllowed(context, model, 'read')

    const target = await this.requireRelationTarget(parent, relationField)
    await this.assertAllowed(context, target.name, 'list')

    // Parsed against the target's metadata: the query describes the records
    // being listed, not the one they hang off.
    return this.projectPage(
      target,
      await this.adapter.listRelated(
        model,
        id,
        relationField,
        this.scopeToFields(target, parseListQuery(rawQuery, target)),
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

  /** The policy's answer for one operation, with a thrown denial read as `false`. */
  private async permits(
    context: ExecutionContext,
    model: string,
    operation: AdminOperation,
  ): Promise<boolean> {
    try {
      return (await this.resourceAuth.authorize({ context, model, operation })) !== false
    } catch (error) {
      if (isNestAdminError(error) && error.kind === 'forbidden') return false
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
    await this.requireModel(model)
    await this.assertAllowed(context, model, 'action')

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
  ): Promise<void> {
    const decision = await this.resourceAuth.authorize({ context, model, operation })
    if (decision === false) throw new ForbiddenError()
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
