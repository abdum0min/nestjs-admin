/**
 * The single seam between Nest Admin and any ORM.
 *
 * Adding support for a new ORM means writing one implementation of
 * {@link OrmAdapter} and nothing else. Core, the NestJS integration, the HTTP
 * contract and the admin UI stay untouched.
 *
 * @experimental Draft contract. Expected to change during MVP implementation.
 */
import type { ModelMetadata } from '../metadata/model.js'
import type { ListQuery, Page } from '../query/query.js'

/**
 * Primary key value of a single record. Composite keys are represented by
 * {@link ModelMetadata.primaryKey}; supporting them at this level is a
 * post-MVP change.
 */
export type RecordId = string | number

/** An untyped record as it crosses the adapter boundary. */
export type RecordData = Record<string, unknown>

export interface OrmAdapter {
  /** Stable identifier used in diagnostics, e.g. `'prisma'`. */
  readonly name: string

  /**
   * Discover the models the adapter can serve. Asynchronous because an adapter
   * may need to read a schema file or import a generated client.
   */
  getModels(): Promise<readonly ModelMetadata[]>

  list(model: string, query: ListQuery): Promise<Page<RecordData>>
  findOne(model: string, id: RecordId): Promise<RecordData | null>
  create(model: string, data: RecordData): Promise<RecordData>
  update(model: string, id: RecordId, data: RecordData): Promise<RecordData>
  delete(model: string, id: RecordId): Promise<void>
}
