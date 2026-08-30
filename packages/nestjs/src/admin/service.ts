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
import { Inject, Injectable, type ExecutionContext, type OnModuleInit } from '@nestjs/common'

import type { AdminOperation, AdminResourceAuth } from '../auth/resource.js'
import { parseListQuery, type RawQuery } from '../http/query-parser.js'
import { ADMIN_ADAPTER, ADMIN_MODELS, ADMIN_RESOURCE_AUTH, ADMIN_RESOURCES } from '../tokens.js'
import { toMetadataDto, type MetadataDto, type ModelPermissionsDto } from './metadata.dto.js'

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @Inject(ADMIN_ADAPTER) private readonly adapter: OrmAdapter,
    @Inject(ADMIN_RESOURCE_AUTH) private readonly resourceAuth: AdminResourceAuth,
    @Inject(ADMIN_RESOURCES) private readonly resources: ResourceSelection | undefined,
    @Inject(ADMIN_MODELS) private readonly overrides: ModelOverrides | undefined,
  ) {}

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

    return toMetadataDto(visible, this.overrides, await this.permissionsFor(context, visible))
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
    return this.project(metadata, await this.adapter.create(model, data))
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
    return this.project(metadata, await this.adapter.update(model, id, data))
  }

  async delete(context: ExecutionContext, model: string, id: RecordId): Promise<void> {
    await this.requireModel(model)
    await this.assertAllowed(context, model, 'delete')
    await this.adapter.delete(model, id)
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
    const allowed = new Set(model.fields.map((field) => field.name))
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
  private scopeToFields(model: ModelMetadata, query: ListQuery): ListQuery {
    return { ...query, fields: model.fields.map((field) => field.name) }
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
   * This closes the gap `reports/009` left open: the interface used to offer
   * `New`, `Edit` and `Delete` to a principal every one of which would refuse.
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
