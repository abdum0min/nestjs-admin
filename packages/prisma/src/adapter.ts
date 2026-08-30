/**
 * `PrismaAdapter` - the Prisma implementation of Core's `OrmAdapter`.
 *
 * The adapter never constructs a Prisma Client. Prisma 7 builds clients from
 * driver adapters, so only the consuming application knows the provider, the
 * credentials and the connection strategy. We receive a constructed client and
 * use it.
 */
import {
  AdapterError,
  FieldNotFoundError,
  InvalidQueryError,
  ModelNotFoundError,
  isNestAdminError,
  RecordNotFoundError,
  type ListQuery,
  type ModelMetadata,
  type OrmAdapter,
  type Page,
  type RecordData,
  type RecordId,
} from '@nest-admin/core'

import { resolveDelegate, type PrismaModelDelegate } from './client/delegate.js'
import { assertSupportedPrismaVersion } from './client/version-gate.js'
import { readPrismaDmmf } from './metadata/read-dmmf.js'
import { toModelMetadata } from './metadata/to-metadata.js'
import { toIncludeClause } from './query/to-include.js'
import { toRelatedWhere } from './query/to-related-where.js'
import { resolvePagination, toFindManyArgs } from './query/to-prisma-args.js'

/** Prisma's error code for "record required but not found". */
const PRISMA_RECORD_NOT_FOUND = 'P2025'

export interface PrismaAdapterOptions {
  /**
   * A constructed Prisma Client. Owned entirely by the consuming application:
   * the adapter never calls `new PrismaClient()`, because under Prisma 7 the
   * client is built from a driver adapter that only the application can supply.
   */
  readonly client: unknown
  /**
   * Path to `schema.prisma`, or to a directory of `.prisma` files. When
   * omitted, `prisma/schema.prisma`, `prisma/schema` and `schema.prisma` are
   * tried in that order, relative to `cwd`.
   */
  readonly schemaPath?: string
  /** Base directory for schema resolution. Defaults to `process.cwd()`. */
  readonly cwd?: string
}

export class PrismaAdapter implements OrmAdapter {
  readonly name = 'prisma'

  readonly #client: unknown
  readonly #schemaPath: string | undefined
  readonly #cwd: string | undefined

  /**
   * Metadata is derived from a static schema, so it is read once and reused.
   * Every operation validates against it, which would otherwise re-parse the
   * schema on each call.
   */
  #models: readonly ModelMetadata[] | undefined

  constructor(options: PrismaAdapterOptions) {
    if (options.client === null || options.client === undefined) {
      throw new AdapterError(
        'PrismaAdapter requires a constructed Prisma Client. ' +
          'Pass one via `new PrismaAdapter({ client })`.',
      )
    }
    this.#client = options.client
    this.#schemaPath = options.schemaPath
    this.#cwd = options.cwd
  }

  async getModels(): Promise<readonly ModelMetadata[]> {
    if (this.#models) return this.#models
    // Checked before parsing: a version mismatch would otherwise surface as
    // "Prisma rejected the schema", pointing at the user's valid schema.
    assertSupportedPrismaVersion(this.#client)
    const dmmf = readPrismaDmmf({
      ...(this.#schemaPath !== undefined ? { schemaPath: this.#schemaPath } : {}),
      ...(this.#cwd !== undefined ? { cwd: this.#cwd } : {}),
    })
    this.#models = toModelMetadata(dmmf)
    return this.#models
  }

  async list(model: string, query: ListQuery): Promise<Page<RecordData>> {
    const metadata = await this.#requireModel(model)
    const delegate = await this.#delegate(model)

    const args = toFindManyArgs(metadata, query)
    const include = toIncludeClause(metadata, await this.getModels())
    const withRelations = include ? { ...args, include } : args
    const { page, perPage } = resolvePagination(query)

    const [rows, total] = await this.#run(model, () =>
      Promise.all([
        delegate.findMany(withRelations),
        delegate.count(args.where ? { where: args.where } : {}),
      ]),
    )

    return { data: rows as RecordData[], total, page, perPage }
  }

  async findOne(model: string, id: RecordId): Promise<RecordData | null> {
    const metadata = await this.#requireModel(model)
    const delegate = await this.#delegate(model)
    const where = this.#whereById(metadata, id)

    const include = toIncludeClause(metadata, await this.getModels())
    const record = await this.#run(model, () =>
      delegate.findUnique(include ? { where, include } : { where }),
    )
    return (record as RecordData | null) ?? null
  }

  async create(model: string, data: RecordData): Promise<RecordData> {
    const metadata = await this.#requireModel(model)
    const delegate = await this.#delegate(model)
    const writable = this.#validateWritableData(metadata, data)

    const created = await this.#run(model, () => delegate.create({ data: writable }))
    return created as RecordData
  }

  async update(model: string, id: RecordId, data: RecordData): Promise<RecordData> {
    const metadata = await this.#requireModel(model)
    const delegate = await this.#delegate(model)
    const where = this.#whereById(metadata, id)
    const writable = this.#validateWritableData(metadata, data)

    const updated = await this.#run(model, () => delegate.update({ where, data: writable }), id)
    return updated as RecordData
  }

  async delete(model: string, id: RecordId): Promise<void> {
    const metadata = await this.#requireModel(model)
    const delegate = await this.#delegate(model)
    const where = this.#whereById(metadata, id)

    await this.#run(model, () => delegate.delete({ where }), id)
  }

  /**
   * A page of the records on the far side of a to-many relation.
   *
   * Implemented as an ordinary list of the *target* model with one extra
   * condition, so pagination, sorting, filtering and relation loading all
   * behave exactly as they do on a top-level list. See `to-related-where.ts`.
   */
  async listRelated(
    model: string,
    id: RecordId,
    relationField: string,
    query: ListQuery,
  ): Promise<Page<RecordData>> {
    const metadata = await this.#requireModel(model)
    const models = await this.getModels()

    // The relation is validated first: a bad field name is wrong whether or
    // not the record exists, and rejecting it here costs no query.
    const { target, where } = toRelatedWhere(metadata, relationField, id, models)

    // A missing parent is a 404, not an empty page. The condition below would
    // simply match nothing, which reads as "this record has no children".
    await this.#requireRecord(model, metadata, id)
    const delegate = await this.#delegate(target.name)

    const args = toFindManyArgs(target, query)
    const combined = args.where ? { AND: [args.where, where] } : where
    const include = toIncludeClause(target, models)

    const { page, perPage } = resolvePagination(query)
    const [rows, total] = await this.#run(target.name, () =>
      Promise.all([
        delegate.findMany({ ...args, where: combined, ...(include ? { include } : {}) }),
        delegate.count({ where: combined }),
      ]),
    )

    return { data: rows as RecordData[], total, page, perPage }
  }

  async attachRelated(
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
  ): Promise<void> {
    await this.#link(model, id, relationField, targetId, 'connect')
  }

  async detachRelated(
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
  ): Promise<void> {
    await this.#link(model, id, relationField, targetId, 'disconnect')
  }

  // ---------------------------------------------------------------- internals

  /**
   * Add or remove one link, from the parent's side.
   *
   * Prisma expresses both the same way and works out where the link is stored -
   * a join-table row for a many-to-many, the child's foreign key for a
   * one-to-many. Whether the operation is allowed is the caller's decision;
   * this performs it.
   */
  async #link(
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
    operation: 'connect' | 'disconnect',
  ): Promise<void> {
    const metadata = await this.#requireModel(model)
    const models = await this.getModels()
    const { target } = toRelatedWhere(metadata, relationField, id, models)

    const [targetKey] = target.primaryKey
    if (targetKey === undefined) {
      throw new FieldNotFoundError(target.name, relationField, 'The target has no primary key.')
    }

    const delegate = await this.#delegate(model)
    await this.#run(
      model,
      () =>
        delegate.update({
          where: this.#whereById(metadata, id),
          data: { [relationField]: { [operation]: { [targetKey]: targetId } } },
        }),
      id,
    )
  }

  /** Throw `RecordNotFoundError` unless the record exists. */
  async #requireRecord(model: string, metadata: ModelMetadata, id: RecordId): Promise<void> {
    const delegate = await this.#delegate(model)
    const found = await this.#run(
      model,
      () => delegate.findUnique({ where: this.#whereById(metadata, id) }),
      id,
    )
    if (found === null || found === undefined) throw new RecordNotFoundError(model, id)
  }

  async #requireModel(model: string): Promise<ModelMetadata> {
    const models = await this.getModels()
    const found = models.find((candidate) => candidate.name === model)
    if (!found) {
      throw new ModelNotFoundError(
        model,
        models.map((candidate) => candidate.name),
      )
    }
    return found
  }

  async #delegate(model: string): Promise<PrismaModelDelegate> {
    const models = await this.getModels()
    return resolveDelegate(
      this.#client,
      model,
      models.map((candidate) => candidate.name),
    )
  }

  /**
   * Build a `where` clause addressing a single record by primary key.
   *
   * Composite keys are represented in metadata but not supported here: a
   * `RecordId` is a single scalar, so there is nothing to map the second
   * column from. Rejected explicitly rather than silently mis-querying.
   */
  #whereById(model: ModelMetadata, id: RecordId): Record<string, unknown> {
    const [primaryKeyField, ...rest] = model.primaryKey

    if (primaryKeyField === undefined) {
      throw new InvalidQueryError(
        `Model "${model.name}" has no primary key, so records cannot be addressed by id.`,
      )
    }
    if (rest.length > 0) {
      throw new InvalidQueryError(
        `Model "${model.name}" has a composite primary key ` +
          `(${model.primaryKey.join(', ')}), which is not supported in this version.`,
      )
    }

    return { [primaryKeyField]: this.#coerceId(model, primaryKeyField, id) }
  }

  /**
   * Coerce an id to the type the schema declares.
   *
   * Ids arriving from a URL are always strings, but a Prisma `Int @id` column
   * must be queried with a number or Prisma rejects the argument.
   */
  #coerceId(model: ModelMetadata, fieldName: string, id: RecordId): RecordId {
    const field = model.fields.find((candidate) => candidate.name === fieldName)
    if (field?.kind !== 'number' || typeof id === 'number') return id

    const numeric = Number(id)
    if (!Number.isFinite(numeric)) {
      throw new InvalidQueryError(
        `Invalid id ${JSON.stringify(id)} for numeric primary key ` +
          `"${model.name}.${fieldName}".`,
      )
    }
    return numeric
  }

  /**
   * Reject anything the caller has no business writing.
   *
   * Unknown keys are an error rather than silently dropped: quietly discarding
   * a field the user filled in is worse than telling them it does not exist.
   * Relation and list fields are rejected because nested writes are not
   * implemented - see the Phase 2 report.
   */
  #validateWritableData(model: ModelMetadata, data: RecordData): RecordData {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new InvalidQueryError(`Write payload for "${model.name}" must be an object.`)
    }

    const writable: RecordData = {}
    for (const [key, value] of Object.entries(data)) {
      const field = model.fields.find((candidate) => candidate.name === key)
      if (!field) {
        throw new FieldNotFoundError(model.name, key)
      }
      if (field.kind === 'relation') {
        throw new FieldNotFoundError(
          model.name,
          key,
          'Writing relation fields is not supported in this version.',
        )
      }
      if (field.isList) {
        throw new FieldNotFoundError(
          model.name,
          key,
          'Writing list fields is not supported in this version.',
        )
      }
      writable[key] = value
    }
    return writable
  }

  /**
   * Run a client call, translating Prisma failures into Core errors.
   *
   * Prisma error types are identified by their `code` property rather than
   * `instanceof`. Importing `@prisma/client` to get the error classes would
   * mean loading a second copy of a package the consumer owns, and would tie
   * us to their Prisma version.
   */
  async #run<T>(model: string, operation: () => Promise<T>, id?: RecordId): Promise<T> {
    try {
      return await operation()
    } catch (cause) {
      if (isNestAdminError(cause)) throw cause

      if (isPrismaError(cause) && cause.code === PRISMA_RECORD_NOT_FOUND && id !== undefined) {
        throw new RecordNotFoundError(model, id)
      }

      const detail = cause instanceof Error ? cause.message : String(cause)
      throw new AdapterError(`Prisma operation failed for model "${model}": ${detail}`, { cause })
    }
  }
}

function isPrismaError(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code: unknown }).code === 'string'
  )
}
