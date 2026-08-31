/**
 * The Drizzle implementation of `OrmAdapter`.
 *
 * This package exists to answer a question the Prisma adapter cannot: is
 * `OrmAdapter` a contract, or is it a description of Prisma? Writing a second
 * implementation against a genuinely different ORM - a query builder with no
 * generated client, no DMMF and no normalised errors - is the only way to find
 * out before 1.0 freezes it.
 *
 * The answer, recorded here because it is the point of the package: Core needed
 * no changes. What differs is entirely inside this directory, and each
 * difference is documented where it is handled.
 *
 * ## What Drizzle does not give us, and what is done instead
 *
 * | Prisma | Drizzle | Handled in |
 * | --- | --- | --- |
 * | DMMF describing every model | the schema object itself | `schema/introspect.ts` |
 * | `P2xxx` codes with `meta` | the driver's own error | `errors/constraints.ts` |
 * | `mode: 'insensitive'` | `lower()` on both sides | `query/build.ts` |
 * | escaped `contains` | escaped by hand | `query/build.ts` |
 * | relations always named | named only if declared | `schema/introspect.ts` |
 *
 * ## Relations are not loaded with the record
 *
 * The Prisma adapter includes a to-one's target so a list can show a person's
 * name rather than their id. Drizzle can do the same with a join, but only with
 * the relational query API, which needs `relations()` declared - and this
 * adapter deliberately works without them. So a to-one arrives as its foreign
 * key, and the interface resolves the label through the relation picker, which
 * it already does for every relation it cannot see inline.
 */
import {
  AdapterError,
  FieldNotFoundError,
  isNestAdminError,
  ModelNotFoundError,
  RecordNotFoundError,
  type ListQuery,
  type ModelMetadata,
  type OrmAdapter,
  type Page,
  type RecordData,
  type RecordId,
} from '@nest-admin/core'
import { and, count, eq, type SQL } from 'drizzle-orm'

import { toConstraintError } from './errors/constraints.js'
import { toModelMetadata } from './metadata/to-metadata.js'
import { buildOrderBy, buildWhere, resolvePagination } from './query/build.js'
import { readSchema, type DrizzleSchema, type DrizzleTable } from './schema/introspect.js'

/** The parts of a Drizzle database this adapter uses. */
interface DrizzleDatabase {
  select(fields?: Record<string, unknown>): {
    from(table: object): QueryBuilder
  }
  insert(table: object): {
    values(data: Record<string, unknown>): { returning(): Promise<Record<string, unknown>[]> }
  }
  update(table: object): {
    set(data: Record<string, unknown>): {
      where(condition: SQL): { returning(): Promise<Record<string, unknown>[]> }
    }
  }
  delete(table: object): {
    where(condition: SQL): { returning(): Promise<Record<string, unknown>[]> }
  }
}

interface QueryBuilder extends Promise<Record<string, unknown>[]> {
  where(condition: SQL | undefined): QueryBuilder
  orderBy(...rules: SQL[]): QueryBuilder
  limit(value: number): QueryBuilder
  offset(value: number): QueryBuilder
}

export interface DrizzleAdapterOptions {
  /** A constructed Drizzle database, from any dialect's `drizzle()`. */
  readonly db: unknown
  /**
   * The schema module.
   *
   * Passed separately from `db` even though `drizzle(client, { schema })` also
   * takes it, because that form is optional and a database built without it
   * carries nothing to introspect.
   */
  readonly schema: Readonly<Record<string, unknown>>
}

export class DrizzleAdapter implements OrmAdapter {
  readonly name = 'drizzle'

  readonly #db: DrizzleDatabase
  readonly #schemaModule: Readonly<Record<string, unknown>>

  #schema: DrizzleSchema | undefined
  #models: readonly ModelMetadata[] | undefined

  constructor(options: DrizzleAdapterOptions) {
    if (options.db === null || options.db === undefined) {
      throw new AdapterError(
        'DrizzleAdapter requires a constructed Drizzle database. ' +
          'Pass one via `new DrizzleAdapter({ db, schema })`.',
      )
    }
    if (options.schema === null || options.schema === undefined) {
      throw new AdapterError(
        'DrizzleAdapter requires the schema module. ' +
          "Import it with `import * as schema from './schema.js'` and pass it as `schema`.",
      )
    }

    this.#db = options.db as DrizzleDatabase
    this.#schemaModule = options.schema
  }

  async getModels(): Promise<readonly ModelMetadata[]> {
    if (this.#models) return this.#models

    const schema = await readSchema(this.#schemaModule)

    if (schema.dialect === 'mysql') {
      // MySQL has no `RETURNING`, so `create` and `update` cannot report what
      // they wrote without a second query and a way to identify the new row -
      // which for a generated key means reading `insertId`, which is dialect
      // and driver specific. Refused here rather than shipped untested: an
      // adapter that silently returns the submitted data instead of the stored
      // row would hide every default and every trigger.
      throw new AdapterError(
        'The Drizzle adapter does not support MySQL yet, because MySQL has no ' +
          'RETURNING clause and writes could not report the stored row. ' +
          'SQLite and PostgreSQL are supported.',
      )
    }

    this.#schema = schema
    this.#models = toModelMetadata({
      schema,
      compositeKeys: await this.#compositeKeys(schema),
    })

    return this.#models
  }

  async list(model: string, query: ListQuery): Promise<Page<RecordData>> {
    const { metadata, entry } = await this.#require(model)

    const where = buildWhere(metadata, entry, query)
    const orderBy = buildOrderBy(metadata, entry, query.sort)
    const { page, perPage, offset, limit } = resolvePagination(query)

    return this.#run(model, async () => {
      let rows = this.#db.select().from(entry.table).where(where)
      if (orderBy.length > 0) rows = rows.orderBy(...orderBy)

      const [data, totals] = await Promise.all([
        rows.limit(limit).offset(offset),
        this.#db.select({ value: count() }).from(entry.table).where(where),
      ])

      const total = Number(totals[0]?.['value'] ?? 0)
      return { data: data as RecordData[], total, page, perPage }
    })
  }

  async findOne(model: string, id: RecordId): Promise<RecordData | null> {
    const { metadata, entry } = await this.#require(model)

    const rows = await this.#run(model, () =>
      this.#db
        .select()
        .from(entry.table)
        .where(this.#byId(metadata, entry, id))
        .limit(1),
    )

    return (rows[0] as RecordData | undefined) ?? null
  }

  async create(model: string, data: RecordData): Promise<RecordData> {
    const { metadata, entry } = await this.#require(model)
    const writable = this.#writable(metadata, entry, data)

    const rows = await this.#run(model, () =>
      this.#db.insert(entry.table).values(writable).returning(),
    )

    const created = rows[0]
    if (created === undefined) {
      throw new AdapterError(`Creating a ${model} returned no row.`)
    }
    return created as RecordData
  }

  async update(model: string, id: RecordId, data: RecordData): Promise<RecordData> {
    const { metadata, entry } = await this.#require(model)
    const writable = this.#writable(metadata, entry, data)

    // An update with nothing to set is a request to see the record, and every
    // dialect rejects `SET` with no assignments.
    if (Object.keys(writable).length === 0) {
      const existing = await this.findOne(model, id)
      if (existing === null) throw new RecordNotFoundError(model, id)
      return existing
    }

    const rows = await this.#run(model, () =>
      this.#db
        .update(entry.table)
        .set(writable)
        .where(this.#byId(metadata, entry, id))
        .returning(),
    )

    const updated = rows[0]
    // Drizzle updates nothing and says nothing when the row is absent; Prisma
    // raises P2025. The contract expects the second, so it is produced here.
    if (updated === undefined) throw new RecordNotFoundError(model, id)
    return updated as RecordData
  }

  async delete(model: string, id: RecordId): Promise<void> {
    const { metadata, entry } = await this.#require(model)

    const rows = await this.#run(model, () =>
      this.#db
        .delete(entry.table)
        .where(this.#byId(metadata, entry, id))
        .returning(),
    )

    if (rows.length === 0) throw new RecordNotFoundError(model, id)
  }

  async listRelated(
    model: string,
    id: RecordId,
    relationField: string,
    query: ListQuery,
  ): Promise<Page<RecordData>> {
    const link = await this.#link(model, relationField)
    const { metadata: targetMetadata, entry: target } = await this.#require(link.targetModel)

    // The parent's own key value, which the children's foreign key holds. Read
    // rather than assumed equal to `id`, because a relation may reference a
    // unique column that is not the primary key.
    const parentValue = await this.#referencedValue(model, id, link.to)

    const foreignKey = target.columns.get(link.from)
    if (foreignKey === undefined) {
      throw new FieldNotFoundError(link.targetModel, link.from)
    }

    const declared = buildWhere(targetMetadata, target, query)
    const belongs = eq(foreignKey as never, parentValue)
    const where = declared ? and(belongs, declared) : belongs

    const orderBy = buildOrderBy(targetMetadata, target, query.sort)
    const { page, perPage, offset, limit } = resolvePagination(query)

    return this.#run(link.targetModel, async () => {
      let rows = this.#db.select().from(target.table).where(where)
      if (orderBy.length > 0) rows = rows.orderBy(...orderBy)

      const [data, totals] = await Promise.all([
        rows.limit(limit).offset(offset),
        this.#db.select({ value: count() }).from(target.table).where(where),
      ])

      return {
        data: data as RecordData[],
        total: Number(totals[0]?.['value'] ?? 0),
        page,
        perPage,
      }
    })
  }

  async attachRelated(
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
  ): Promise<void> {
    const link = await this.#link(model, relationField)
    const parentValue = await this.#referencedValue(model, id, link.to)

    // Rewriting the child's key, which also removes it from whoever held it.
    // The contract says so, and says the warning is the transport's job.
    await this.#setForeignKey(link, targetId, parentValue)
  }

  async detachRelated(
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
  ): Promise<void> {
    const link = await this.#link(model, relationField)
    await this.#setForeignKey(link, targetId, null)
  }

  /* ---------------------------------------------------------------------- */

  async #require(model: string): Promise<{ metadata: ModelMetadata; entry: DrizzleTable }> {
    const models = await this.getModels()
    const metadata = models.find((candidate) => candidate.name === model)
    if (!metadata) throw new ModelNotFoundError(model)

    const entry = this.#schema?.tables.find((candidate) => candidate.model === model)
    if (!entry) throw new ModelNotFoundError(model)

    return { metadata, entry }
  }

  /**
   * The two ends of a to-many, resolved to property names.
   *
   * `from` is the foreign key on the child, `to` the column on this model it
   * points at. Only the `one` side carries them, so a `many` is resolved by
   * finding its partner - which is why both sides are given the same relation
   * name when the schema is read.
   */
  async #link(
    model: string,
    relationField: string,
  ): Promise<{ targetModel: string; from: string; to: string }> {
    const { metadata } = await this.#require(model)

    const field = metadata.fields.find((candidate) => candidate.name === relationField)
    if (!field?.relation) throw new FieldNotFoundError(model, relationField)

    if (field.relation.cardinality !== 'many') {
      throw new FieldNotFoundError(
        model,
        relationField,
        'Only to-many relations can be listed or modified through this route.',
      )
    }

    const models = await this.getModels()
    const target = models.find((candidate) => candidate.name === field.relation?.targetModel)
    const inverse = target?.fields.find(
      (candidate) =>
        candidate.relation?.cardinality === 'one' &&
        candidate.relation.name === field.relation?.name,
    )

    const from = inverse?.relation?.from
    const to = inverse?.relation?.to

    if (from === undefined || to === undefined) {
      // A many-to-many, or a relation whose owning side is not in this admin.
      // Drizzle has no first-class many-to-many: a join table is a table, and
      // appears in the admin as one, with a to-one on each side.
      throw new FieldNotFoundError(
        model,
        relationField,
        'This relation has no foreign key on the far side. A many-to-many in ' +
          'Drizzle is a join table, and is administered as its own resource.',
      )
    }

    return { targetModel: field.relation.targetModel, from, to }
  }

  async #referencedValue(model: string, id: RecordId, column: string): Promise<unknown> {
    const record = await this.findOne(model, id)
    if (record === null) throw new RecordNotFoundError(model, id)
    return record[column]
  }

  async #setForeignKey(
    link: { targetModel: string; from: string },
    targetId: RecordId,
    value: unknown,
  ): Promise<void> {
    const { metadata, entry } = await this.#require(link.targetModel)

    await this.#run(link.targetModel, () =>
      this.#db
        .update(entry.table)
        .set({ [link.from]: value })
        .where(this.#byId(metadata, entry, targetId))
        .returning(),
    )
  }

  #byId(metadata: ModelMetadata, entry: DrizzleTable, id: RecordId): SQL {
    const key = metadata.primaryKey[0]
    if (key === undefined || metadata.primaryKey.length > 1) {
      throw new AdapterError(
        `${metadata.name} has ${metadata.primaryKey.length === 0 ? 'no' : 'a composite'} ` +
          'primary key. Records are addressed by a single key in this version.',
      )
    }

    const column = entry.columns.get(key)
    if (column === undefined) throw new FieldNotFoundError(metadata.name, key)

    // A numeric key arrives from the URL as a string, and `=` on an integer
    // column would compare against text.
    const field = metadata.fields.find((candidate) => candidate.name === key)
    const value = field?.kind === 'number' ? Number(id) : id

    return eq(column as never, value)
  }

  /**
   * The submitted data, restricted to columns that exist and may be written.
   *
   * Generated columns are dropped rather than refused: a form that round-trips
   * a record would otherwise fail on the id it was shown. Unknown keys *are*
   * refused, because silently ignoring a field is how a value appears to save
   * and does not.
   */
  #writable(metadata: ModelMetadata, entry: DrizzleTable, data: RecordData): RecordData {
    const writable: RecordData = {}

    for (const [key, value] of Object.entries(data)) {
      const field = metadata.fields.find((candidate) => candidate.name === key)

      if (!field || !entry.columns.has(key)) {
        // A relation field is a legitimate name that is not a column; anything
        // else is a mistake worth reporting.
        if (field?.kind === 'relation') continue
        throw new FieldNotFoundError(metadata.name, key)
      }

      if (field.isGenerated && field.isId) continue

      writable[key] =
        field.kind === 'datetime' && typeof value === 'string' ? new Date(value) : value
    }

    return writable
  }

  /** Composite primary keys, which are only reachable through the dialect's config. */
  async #compositeKeys(schema: DrizzleSchema): Promise<ReadonlyMap<string, readonly string[]>> {
    const core = (await import(
      schema.dialect === 'pg' ? 'drizzle-orm/pg-core' : 'drizzle-orm/sqlite-core'
    )) as {
      getTableConfig: (table: object) => {
        primaryKeys: readonly { columns: readonly { name: string }[] }[]
      }
    }

    const keys = new Map<string, readonly string[]>()

    for (const entry of schema.tables) {
      const declared = core.getTableConfig(entry.table).primaryKeys[0]
      if (declared === undefined) continue

      const names: string[] = []
      for (const column of declared.columns) {
        for (const [key, candidate] of entry.columns) {
          if (candidate.name === column.name) names.push(key)
        }
      }

      if (names.length > 0) keys.set(entry.model, names)
    }

    return keys
  }

  /**
   * Run a query, and translate whatever it throws.
   *
   * Core's own errors pass through: they were raised by this adapter and
   * already say what is wrong. Everything else is the driver's, and becomes
   * either a constraint the interface can put beside a field or an
   * `AdapterError`, which the HTTP layer reports without its message.
   */
  async #run<T>(model: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (cause) {
      if (isNestAdminError(cause)) throw cause

      const entry = this.#schema?.tables.find((candidate) => candidate.model === model)
      const toFieldNames = (sqlNames: readonly string[]): readonly string[] => {
        if (entry === undefined) return sqlNames
        const named: string[] = []
        for (const sqlName of sqlNames) {
          for (const [key, column] of entry.columns) {
            if (column.name === sqlName) named.push(key)
          }
        }
        return named
      }

      const constraint = toConstraintError(cause, model, toFieldNames)
      if (constraint) throw constraint

      throw new AdapterError(
        `The database refused a ${model} operation: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      )
    }
  }
}
