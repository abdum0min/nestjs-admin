/**
 * Coordinates admin operations between the HTTP layer and the ORM adapter.
 *
 * It speaks Core vocabulary only. It has no idea which ORM is underneath, and
 * it must stay that way: this is the layer that would otherwise accumulate
 * "just this once" ORM-specific branches.
 */
import {
  ModelNotFoundError,
  RecordNotFoundError,
  type ModelMetadata,
  type OrmAdapter,
  type Page,
  type RecordData,
  type RecordId,
} from '@nest-admin/core'
import { Inject, Injectable } from '@nestjs/common'

import { ADMIN_ADAPTER } from '../tokens.js'
import { parseListQuery, type RawQuery } from '../http/query-parser.js'
import { toMetadataDto, type MetadataDto } from './metadata.dto.js'

@Injectable()
export class AdminService {
  constructor(@Inject(ADMIN_ADAPTER) private readonly adapter: OrmAdapter) {}

  /** The public metadata document a frontend renders resources from. */
  async getMetadata(): Promise<MetadataDto> {
    return toMetadataDto(await this.adapter.getModels())
  }

  /**
   * List records.
   *
   * Metadata is resolved first because query parsing is type-directed: only
   * the schema knows whether `price` should arrive as a number or a string.
   */
  async list(model: string, rawQuery: RawQuery): Promise<Page<RecordData>> {
    const metadata = await this.requireModel(model)
    return this.adapter.list(model, parseListQuery(rawQuery, metadata))
  }

  /**
   * Fetch one record.
   *
   * The adapter returns `null` for a missing record; over HTTP that is a 404,
   * so it is turned into an error here rather than in the controller.
   */
  async findOne(model: string, id: RecordId): Promise<RecordData> {
    const record = await this.adapter.findOne(model, id)
    if (record === null) throw new RecordNotFoundError(model, id)
    return record
  }

  async create(model: string, data: RecordData): Promise<RecordData> {
    return this.adapter.create(model, data)
  }

  async update(model: string, id: RecordId, data: RecordData): Promise<RecordData> {
    return this.adapter.update(model, id, data)
  }

  async delete(model: string, id: RecordId): Promise<void> {
    await this.adapter.delete(model, id)
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
