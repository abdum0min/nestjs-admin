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

  /**
   * A page of the records on the far side of a to-many relation.
   *
   * Paginated for the same reason a list is: the number of children is a
   * property of the data, not of the schema, and a parent with fifty thousand
   * of them must not be a page that never loads.
   *
   * Kept separate from `list` rather than expressed as a filter because a
   * many-to-many has no column to filter on - the link lives in a join table.
   * A one-to-many could be asked for either way; going through one method means
   * the caller does not have to know which it is looking at.
   */
  listRelated(
    model: string,
    id: RecordId,
    relationField: string,
    query: ListQuery,
  ): Promise<Page<RecordData>>

  /**
   * Link an existing record to this one.
   *
   * Across a many-to-many this adds a row to the join table and changes
   * neither record. Across a one-to-many it rewrites the child's foreign key,
   * which also **removes it from whatever parent held it** - the same operation
   * with a consequence the caller should have been told about. Deciding whether
   * to warn is the transport layer's job; the adapter performs what it is asked.
   */
  attachRelated(
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
  ): Promise<void>

  /**
   * Unlink a record from this one, without deleting either.
   *
   * Across a one-to-many this clears the child's foreign key, which is
   * impossible when that column is required - see `detachBlockedReason`. The
   * adapter may assume the caller has checked, and will surface the database's
   * own refusal if it has not.
   */
  detachRelated(
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
  ): Promise<void>
}
