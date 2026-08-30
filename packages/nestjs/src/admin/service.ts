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
  ForbiddenError,
  isNestAdminError,
  ModelNotFoundError,
  RecordNotFoundError,
  type ModelMetadata,
  type OrmAdapter,
  type Page,
  type RecordData,
  type RecordId,
  type ResourceSelection,
  selectModels,
  unknownSelectionNames,
} from '@nest-admin/core'
import { Inject, Injectable, type ExecutionContext, type OnModuleInit } from '@nestjs/common'

import type { AdminOperation, AdminResourceAuth } from '../auth/resource.js'
import { parseListQuery, type RawQuery } from '../http/query-parser.js'
import { ADMIN_ADAPTER, ADMIN_RESOURCE_AUTH, ADMIN_RESOURCES } from '../tokens.js'
import { toMetadataDto, type MetadataDto } from './metadata.dto.js'

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @Inject(ADMIN_ADAPTER) private readonly adapter: OrmAdapter,
    @Inject(ADMIN_RESOURCE_AUTH) private readonly resourceAuth: AdminResourceAuth,
    @Inject(ADMIN_RESOURCES) private readonly resources: ResourceSelection | undefined,
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
    const unknown = unknownSelectionNames(await this.adapter.getModels(), this.resources)
    if (unknown.length === 0) return

    const known = (await this.adapter.getModels()).map((model) => model.name)
    throw new Error(
      `AdminModule \`resources\` names ${unknown.length === 1 ? 'a model' : 'models'} ` +
        `that the schema does not have: ${unknown.join(', ')}. ` +
        `Known models: ${known.join(', ')}.`,
    )
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

    return toMetadataDto(visible)
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
    return this.adapter.list(model, parseListQuery(rawQuery, metadata))
  }

  /**
   * Fetch one record.
   *
   * The adapter returns `null` for a missing record; over HTTP that is a 404,
   * so it is turned into an error here rather than in the controller.
   */
  async findOne(context: ExecutionContext, model: string, id: RecordId): Promise<RecordData> {
    await this.requireModel(model)
    await this.assertAllowed(context, model, 'read')
    const record = await this.adapter.findOne(model, id)
    if (record === null) throw new RecordNotFoundError(model, id)
    return record
  }

  async create(context: ExecutionContext, model: string, data: RecordData): Promise<RecordData> {
    await this.requireModel(model)
    await this.assertAllowed(context, model, 'create')
    return this.adapter.create(model, data)
  }

  async update(
    context: ExecutionContext,
    model: string,
    id: RecordId,
    data: RecordData,
  ): Promise<RecordData> {
    await this.requireModel(model)
    await this.assertAllowed(context, model, 'update')
    return this.adapter.update(model, id, data)
  }

  async delete(context: ExecutionContext, model: string, id: RecordId): Promise<void> {
    await this.requireModel(model)
    await this.assertAllowed(context, model, 'delete')
    await this.adapter.delete(model, id)
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
    return selectModels(await this.adapter.getModels(), this.resources)
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
