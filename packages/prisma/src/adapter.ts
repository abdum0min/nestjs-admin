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
  NestAdminError,
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
    const { page, perPage } = resolvePagination(query)

    const [rows, total] = await this.#run(model, () =>
      Promise.all([
        delegate.findMany(args),
        delegate.count(args.where ? { where: args.where } : {}),
      ]),
    )

    return { data: rows as RecordData[], total, page, perPage }
  }

  async findOne(model: string, id: RecordId): Promise<RecordData | null> {
    const metadata = await this.#requireModel(model)
    const delegate = await this.#delegate(model)
    const where = this.#whereById(metadata, id)

    const record = await this.#run(model, () => delegate.findUnique({ where }))
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

  // ---------------------------------------------------------------- internals

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
      if (cause instanceof NestAdminError) throw cause

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
