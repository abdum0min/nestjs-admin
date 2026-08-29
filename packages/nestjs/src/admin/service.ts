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
  ModelNotFoundError,
  RecordNotFoundError,
  type ModelMetadata,
  type OrmAdapter,
  type Page,
  type RecordData,
  type RecordId,
} from '@nest-admin/core'
import { Inject, Injectable, type ExecutionContext } from '@nestjs/common'

import type { AdminOperation, AdminResourceAuth } from '../auth/resource.js'
import { parseListQuery, type RawQuery } from '../http/query-parser.js'
import { ADMIN_ADAPTER, ADMIN_RESOURCE_AUTH } from '../tokens.js'
import { toMetadataDto, type MetadataDto } from './metadata.dto.js'

@Injectable()
export class AdminService {
  constructor(
    @Inject(ADMIN_ADAPTER) private readonly adapter: OrmAdapter,
    @Inject(ADMIN_RESOURCE_AUTH) private readonly resourceAuth: AdminResourceAuth,
  ) {}

  /**
   * The public metadata document a frontend renders resources from.
   *
   * Models the principal may not see are filtered out **before** mapping, so a
   * denied model never reaches the DTO at all - not its name, fields, relations,
   * primary key or enum values. The response is not "everything, minus some";
   * it is a description of the schema this principal has.
   */
  async getMetadata(context: ExecutionContext): Promise<MetadataDto> {
    const models = await this.adapter.getModels()

    const visible: ModelMetadata[] = []
    for (const model of models) {
      if (await this.isVisible(context, model.name)) visible.push(model)
    }

    return toMetadataDto(visible)
  }

  /**
   * List records.
   *
   * Authorization runs first, so a denied model never reaches `adapter.list`.
   * Metadata is resolved second because query parsing is type-directed: only
   * the schema knows whether `price` should arrive as a number or a string.
   */
  async list(
    context: ExecutionContext,
    model: string,
    rawQuery: RawQuery,
  ): Promise<Page<RecordData>> {
    await this.assertAllowed(context, model, 'list')
    const metadata = await this.requireModel(model)
    return this.adapter.list(model, parseListQuery(rawQuery, metadata))
  }

  /**
   * Fetch one record.
   *
   * The adapter returns `null` for a missing record; over HTTP that is a 404,
   * so it is turned into an error here rather than in the controller.
   */
  async findOne(context: ExecutionContext, model: string, id: RecordId): Promise<RecordData> {
    await this.assertAllowed(context, model, 'read')
    const record = await this.adapter.findOne(model, id)
    if (record === null) throw new RecordNotFoundError(model, id)
    return record
  }

  async create(context: ExecutionContext, model: string, data: RecordData): Promise<RecordData> {
    await this.assertAllowed(context, model, 'create')
    return this.adapter.create(model, data)
  }

  async update(
    context: ExecutionContext,
    model: string,
    id: RecordId,
    data: RecordData,
  ): Promise<RecordData> {
    await this.assertAllowed(context, model, 'update')
    return this.adapter.update(model, id, data)
  }

  async delete(context: ExecutionContext, model: string, id: RecordId): Promise<void> {
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
      if (error instanceof ForbiddenError) return false
      throw error
    }
  }

  /**
   * Resolve a model name to its metadata.
   *
   * The adapter validates model names too, and would reject an unknown name on
   * its own. The lookup is repeated here only because the query parser needs
   * the metadata; the error raised is the adapter's own type, so the behaviour
   * a client sees is identical either way.
   */
  private async requireModel(model: string): Promise<ModelMetadata> {
    const models = await this.adapter.getModels()
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
