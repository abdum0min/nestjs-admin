/**
 * Reading a Drizzle schema.
 *
 * Drizzle has no DMMF and no generated client to interrogate. What it has is
 * the schema module itself - a plain object of table definitions - and the
 * table objects carry everything needed, because Drizzle Kit reads them the
 * same way to write migrations.
 *
 * ## Where the names come from
 *
 * A Drizzle table has two names: the SQL one (`users`) and the key it is
 * exported under (`users`, or `Users`, or whatever the developer wrote). This
 * uses the **export key** as the model name, and the **property key** as the
 * field name.
 *
 * That is deliberate. Those are the names the developer typed, the names their
 * own queries use, and - since rows come back keyed by property rather than by
 * column - the names the data already arrives under. Using the SQL names would
 * mean an admin whose URLs and configuration disagree with the schema file the
 * developer is looking at.
 *
 * ## Dialect
 *
 * `getTableConfig` is exported per dialect, not generically, and foreign keys
 * are only reachable through it. The dialect is discoverable without importing
 * any of them: every column's `columnType` is prefixed with it (`SQLiteText`,
 * `PgInteger`, `MySqlInt`). So the dialect is detected from the schema and the
 * matching module is imported once, on demand - which also means a SQLite
 * application never loads the Postgres core.
 */
import { AdapterError } from '@nest-admin/core'
import {
  createTableRelationsHelpers,
  getTableColumns,
  getTableName,
  is,
  Many,
  One,
  Relations,
  SQL,
  Table,
} from 'drizzle-orm'

/** What a Drizzle column exposes. Structural, because the generic type is not usable here. */
export interface DrizzleColumn {
  readonly name: string
  readonly dataType: string
  readonly columnType: string
  readonly notNull: boolean
  readonly hasDefault: boolean
  readonly primary: boolean
  readonly isUnique: boolean
  readonly autoIncrement?: boolean
  readonly enumValues?: readonly string[] | undefined
  readonly default?: unknown
  readonly defaultFn?: unknown
  readonly onUpdateFn?: unknown
}

export type Dialect = 'sqlite' | 'pg' | 'mysql'

/** A table, under the name the developer exported it as. */
export interface DrizzleTable {
  /** The export key. This is the model name the admin uses everywhere. */
  readonly model: string
  /** The SQL table name. Only used in diagnostics. */
  readonly sqlName: string
  readonly table: object
  /** Property key to column. The property key is the field name. */
  readonly columns: ReadonlyMap<string, DrizzleColumn>
}

/** One side of a relation, resolved to property keys. */
export interface DrizzleRelation {
  /** The model this field is on. */
  readonly model: string
  /** The field name it appears under. */
  readonly field: string
  readonly targetModel: string
  readonly cardinality: 'one' | 'many'
  /**
   * Shared by both sides, so `inverseRelationField` can pair them.
   *
   * Built from the foreign key rather than from either field name, because the
   * two sides are named independently and a name derived from one of them
   * would not match the other.
   */
  readonly name: string
  /** On the `one` side: the foreign key on this model, and what it points at. */
  readonly from?: string
  readonly to?: string
}

export interface DrizzleSchema {
  readonly dialect: Dialect
  readonly tables: readonly DrizzleTable[]
  readonly relations: readonly DrizzleRelation[]
}

interface TableConfig {
  readonly primaryKeys: readonly { readonly columns: readonly DrizzleColumn[] }[]
  readonly foreignKeys: readonly {
    reference(): {
      readonly columns: readonly DrizzleColumn[]
      readonly foreignTable: object
      readonly foreignColumns: readonly DrizzleColumn[]
    }
  }[]
}

function dialectOf(tables: readonly DrizzleTable[]): Dialect {
  for (const entry of tables) {
    for (const column of entry.columns.values()) {
      if (column.columnType.startsWith('SQLite')) return 'sqlite'
      if (column.columnType.startsWith('Pg')) return 'pg'
      if (column.columnType.startsWith('MySql')) return 'mysql'
    }
  }

  throw new AdapterError(
    'Could not tell which SQL dialect this Drizzle schema uses. ' +
      'Pass a schema containing at least one table with at least one column.',
  )
}

const CORES: Readonly<Record<Dialect, string>> = {
  sqlite: 'drizzle-orm/sqlite-core',
  pg: 'drizzle-orm/pg-core',
  mysql: 'drizzle-orm/mysql-core',
}

async function configReader(dialect: Dialect): Promise<(table: object) => TableConfig> {
  const core = (await import(CORES[dialect])) as {
    getTableConfig: (table: object) => TableConfig
  }
  return core.getTableConfig
}

/** The property key a column is exported under, given its SQL name. */
function keyOf(entry: DrizzleTable, column: DrizzleColumn): string | undefined {
  for (const [key, candidate] of entry.columns) {
    if (candidate.name === column.name) return key
  }
  return undefined
}

/**
 * Relations the developer declared with `relations()`.
 *
 * Read by calling the config with Drizzle's own helpers, which is how Drizzle's
 * relational queries read it too. When they are declared, their names are
 * authoritative: `author` is what the developer called it, and no heuristic
 * should overrule that.
 */
function declaredRelations(
  schema: Readonly<Record<string, unknown>>,
  tables: readonly DrizzleTable[],
  nameOfFk: (child: string, fk: string) => string,
): readonly DrizzleRelation[] {
  const byTable = new Map(tables.map((entry) => [entry.table, entry]))
  const found: DrizzleRelation[] = []

  for (const value of Object.values(schema)) {
    if (!is(value, Relations)) continue

    const owner = byTable.get(value.table)
    if (owner === undefined) continue

    const built = value.config(createTableRelationsHelpers(value.table)) as Record<string, unknown>

    for (const [field, relation] of Object.entries(built)) {
      const one = is(relation, One)
      if (!one && !is(relation, Many)) continue

      const target = byTable.get((relation as { referencedTable: object }).referencedTable)
      if (target === undefined) continue

      if (!one) {
        // A `many` declares no columns; the foreign key lives on the far side,
        // and the pairing name is worked out once both sides are known.
        found.push({
          model: owner.model,
          field,
          targetModel: target.model,
          cardinality: 'many',
          name: '',
        })
        continue
      }

      const config = (relation as { config?: { fields?: readonly DrizzleColumn[] } }).config
      const fk = config?.fields?.[0]
      const reference = (relation as { config?: { references?: readonly DrizzleColumn[] } }).config
        ?.references?.[0]
      const fkKey = fk ? keyOf(owner, fk) : undefined
      const refKey = reference ? keyOf(target, reference) : undefined

      found.push({
        model: owner.model,
        field,
        targetModel: target.model,
        cardinality: 'one',
        name: fkKey ? nameOfFk(owner.model, fkKey) : '',
        ...(fkKey !== undefined ? { from: fkKey } : {}),
        ...(refKey !== undefined ? { to: refKey } : {}),
      })
    }
  }

  return found
}

/**
 * Read a Drizzle schema module into something ORM-neutral.
 *
 * Relations come from `relations()` where the developer declared them, and from
 * foreign keys where they did not - so an admin works against a schema that has
 * never heard of Drizzle's relational API, and uses the developer's own names
 * the moment it has.
 */
export async function readSchema(
  schema: Readonly<Record<string, unknown>>,
): Promise<DrizzleSchema> {
  const tables: DrizzleTable[] = []

  for (const [model, value] of Object.entries(schema)) {
    if (!is(value, Table)) continue

    const columns = new Map<string, DrizzleColumn>(
      Object.entries(getTableColumns(value) as Record<string, DrizzleColumn>),
    )

    tables.push({ model, sqlName: getTableName(value), table: value, columns })
  }

  if (tables.length === 0) {
    throw new AdapterError(
      'This Drizzle schema exports no tables. Pass the schema module itself, ' +
        "for example `new DrizzleAdapter({ db, schema })` after `import * as schema from './schema.js'`.",
    )
  }

  const dialect = dialectOf(tables)
  const getTableConfig = await configReader(dialect)
  const byTable = new Map(tables.map((entry) => [entry.table, entry]))

  const nameOfFk = (child: string, fk: string): string => `${child}.${fk}`

  const declared = declaredRelations(schema, tables, nameOfFk)
  const declaredOn = new Set(declared.map((relation) => `${relation.model}.${relation.field}`))

  const relations: DrizzleRelation[] = []

  // Foreign keys, read from both ends. Each one is two fields: a `one` on the
  // table that holds the key, and a `many` on the table it points at.
  for (const child of tables) {
    for (const foreign of getTableConfig(child.table).foreignKeys) {
      const reference = foreign.reference()
      const parent = byTable.get(reference.foreignTable)
      const column = reference.columns[0]
      const target = reference.foreignColumns[0]
      if (parent === undefined || column === undefined || target === undefined) continue

      const fkKey = keyOf(child, column)
      const refKey = keyOf(parent, target)
      if (fkKey === undefined || refKey === undefined) continue

      const name = nameOfFk(child.model, fkKey)

      // Only where the developer declared nothing. A declared relation carries
      // the name they chose, and inventing a second field beside it would show
      // the same link twice.
      const declaredOne = declared.find(
        (relation) => relation.cardinality === 'one' && relation.name === name,
      )

      if (declaredOne === undefined) {
        relations.push({
          model: child.model,
          // `authorId` describes a column; `author` describes the thing on the
          // other end, which is what a person reading a record wants named.
          field: relationFieldName(fkKey, child.columns),
          targetModel: parent.model,
          cardinality: 'one',
          name,
          from: fkKey,
          to: refKey,
        })
      }

      const declaredMany = declared.find(
        (relation) =>
          relation.cardinality === 'many' &&
          relation.model === parent.model &&
          relation.targetModel === child.model &&
          relation.name === '',
      )

      if (declaredMany === undefined) {
        relations.push({
          model: parent.model,
          field: manyFieldName(child.model, parent, declaredOn),
          targetModel: child.model,
          cardinality: 'many',
          name,
        })
      } else {
        // Pair the declared `many` with this key, so both sides share a name.
        relations.push({ ...declaredMany, name })
      }
    }
  }

  // Declared `one` relations keep their own field names.
  for (const relation of declared) {
    if (relation.cardinality === 'one' && relation.name !== '') relations.push(relation)
  }

  return { dialect, tables, relations }
}

/**
 * `authorId` becomes `author`, unless something is already called that.
 *
 * The suffix is stripped rather than the field being called `authorId` twice,
 * because the relation and the key are two different things: one is a record,
 * the other is an opaque string, and the interface renders them differently.
 */
function relationFieldName(fkKey: string, columns: ReadonlyMap<string, DrizzleColumn>): string {
  const stripped = /^(.+?)(Id|_id|ID)$/.exec(fkKey)?.[1]
  if (stripped === undefined || stripped === '') return `${fkKey}Ref`
  return columns.has(stripped) ? `${fkKey}Ref` : stripped
}

/** `Post` on `User` becomes `posts`, unless the table already has that column. */
function manyFieldName(
  childModel: string,
  parent: DrizzleTable,
  declaredOn: ReadonlySet<string>,
): string {
  const base = `${childModel.charAt(0).toLowerCase()}${childModel.slice(1)}`
  const plural = base.endsWith('s') ? base : `${base}s`
  const taken = parent.columns.has(plural) || declaredOn.has(`${parent.model}.${plural}`)
  return taken ? `${plural}Related` : plural
}

export { SQL }
