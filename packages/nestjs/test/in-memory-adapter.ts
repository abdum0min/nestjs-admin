/**
 * An `OrmAdapter` backed by plain objects.
 *
 * This is not a mock of Prisma - it is a second, independent implementation of
 * the Core contract. Testing the HTTP layer against it proves something the
 * Prisma adapter cannot: that the HTTP layer depends on the contract and
 * nothing else. If an ORM assumption ever leaks into a controller or the query
 * parser, these tests break.
 *
 * It implements only what the contract requires, and deliberately no more -
 * filtering and sorting here are simple, because the point is the HTTP
 * boundary, not a second query engine. The real query semantics are covered by
 * the Prisma adapter's own suite and by the end-to-end tests.
 */
import {
  FieldNotFoundError,
  ModelNotFoundError,
  RecordNotFoundError,
  type ListQuery,
  type ModelMetadata,
  type OrmAdapter,
  type Page,
  type RecordData,
  type RecordId,
} from '@nest-admin/core'

export const TEST_MODELS: readonly ModelMetadata[] = [
  {
    name: 'User',
    primaryKey: ['id'],
    fields: [
      {
        name: 'id',
        kind: 'string',
        isId: true,
        isRequired: true,
        isUnique: false,
        isList: false,
        isGenerated: true,
      },
      {
        name: 'email',
        kind: 'string',
        isId: false,
        isRequired: true,
        isUnique: true,
        isList: false,
        isGenerated: false,
      },
      {
        name: 'name',
        kind: 'string',
        isId: false,
        isRequired: false,
        isUnique: false,
        isList: false,
        isGenerated: false,
      },
      {
        // Optional and free text: the field the override tests hide, because
        // hiding a required one would make creation impossible.
        name: 'bio',
        kind: 'string',
        isId: false,
        isRequired: false,
        isUnique: false,
        isList: false,
        isGenerated: false,
      },
      {
        name: 'age',
        kind: 'number',
        isId: false,
        isRequired: false,
        isUnique: false,
        isList: false,
        isGenerated: false,
      },
      {
        name: 'active',
        kind: 'boolean',
        isId: false,
        isRequired: true,
        isUnique: false,
        isList: false,
        isGenerated: false,
        defaultValue: true,
      },
      {
        name: 'role',
        kind: 'enum',
        isId: false,
        isRequired: true,
        isUnique: false,
        isList: false,
        isGenerated: false,
        defaultValue: 'USER',
        enumValues: ['USER', 'ADMIN'],
      },
      {
        name: 'createdAt',
        kind: 'datetime',
        isId: false,
        isRequired: true,
        isUnique: false,
        isList: false,
        isGenerated: true,
      },
      {
        name: 'posts',
        kind: 'relation',
        isId: false,
        isRequired: true,
        isUnique: false,
        isList: true,
        isGenerated: false,
        relation: { targetModel: 'Post', cardinality: 'many', name: 'PostToUser' },
      },
    ],
  },
  {
    name: 'Post',
    primaryKey: ['id'],
    fields: [
      {
        name: 'id',
        kind: 'string',
        isId: true,
        isRequired: true,
        isUnique: false,
        isList: false,
        isGenerated: true,
      },
      {
        name: 'title',
        kind: 'string',
        isId: false,
        isRequired: true,
        isUnique: false,
        isList: false,
        isGenerated: false,
      },
      {
        name: 'body',
        kind: 'string',
        isId: false,
        isRequired: false,
        isUnique: false,
        isList: false,
        isGenerated: false,
      },
      {
        name: 'author',
        kind: 'relation',
        isId: false,
        isRequired: true,
        isUnique: false,
        isList: false,
        isGenerated: false,
        relation: {
          targetModel: 'User',
          cardinality: 'one',
          from: 'authorId',
          to: 'id',
          name: 'PostToUser',
        },
      },
    ],
  },
]

/** Records the last query the adapter received, so tests can assert on parsing. */
export interface RecordedCall {
  readonly model: string
  readonly query: ListQuery
}

export class InMemoryAdapter implements OrmAdapter {
  readonly name = 'in-memory'

  /** Populated by the HTTP layer; inspected by tests to verify query parsing. */
  lastListQuery: RecordedCall | undefined

  #rows = new Map<string, RecordData[]>()
  #nextId = 1

  constructor(seed: Readonly<Record<string, readonly RecordData[]>> = {}) {
    for (const model of TEST_MODELS) {
      this.#rows.set(model.name, [...(seed[model.name] ?? [])])
    }
  }

  async getModels(): Promise<readonly ModelMetadata[]> {
    return TEST_MODELS
  }

  async list(model: string, query: ListQuery): Promise<Page<RecordData>> {
    const rows = this.#require(model)
    // Honours `query.fields` the same way the real adapter does, so the tests
    // that assert a hidden column is unreachable are asserting the contract
    // rather than one implementation of it.
    const allowed = query.fields ? new Set(query.fields) : undefined
    this.lastListQuery = { model, query }

    let result = [...rows]

    for (const rule of query.filters ?? []) {
      this.#assertField(model, rule.field, allowed)
      result = result.filter((row) => matches(row[rule.field], rule.operator, rule.value))
    }

    if (query.search) {
      const term = query.search.toLowerCase()
      result = result.filter((row) =>
        Object.entries(row).some(
          ([key, value]) =>
            (!allowed || allowed.has(key)) &&
            typeof value === 'string' &&
            value.toLowerCase().includes(term),
        ),
      )
    }

    for (const rule of [...(query.sort ?? [])].reverse()) {
      this.#assertField(model, rule.field, allowed)
      result.sort(
        (a, b) => compare(a[rule.field], b[rule.field]) * (rule.direction === 'asc' ? 1 : -1),
      )
    }

    const total = result.length
    const page = query.page ?? 1
    const perPage = query.perPage ?? 25
    const start = (page - 1) * perPage

    return { data: result.slice(start, start + perPage), total, page, perPage }
  }

  async findOne(model: string, id: RecordId): Promise<RecordData | null> {
    return this.#require(model).find((row) => String(row['id']) === String(id)) ?? null
  }

  async create(model: string, data: RecordData): Promise<RecordData> {
    const rows = this.#require(model)
    for (const key of Object.keys(data)) this.#assertField(model, key)

    const created: RecordData = { id: `generated-${this.#nextId++}`, ...data }
    rows.push(created)
    return created
  }

  async update(model: string, id: RecordId, data: RecordData): Promise<RecordData> {
    const rows = this.#require(model)
    const index = rows.findIndex((row) => String(row['id']) === String(id))
    if (index === -1) throw new RecordNotFoundError(model, id)
    for (const key of Object.keys(data)) this.#assertField(model, key)

    const updated: RecordData = { ...rows[index], ...data }
    rows[index] = updated
    return updated
  }

  async delete(model: string, id: RecordId): Promise<void> {
    const rows = this.#require(model)
    const index = rows.findIndex((row) => String(row['id']) === String(id))
    if (index === -1) throw new RecordNotFoundError(model, id)
    rows.splice(index, 1)
  }

  /**
   * Related records, by matching the child's foreign key.
   *
   * The double only models one-to-many, which is what the fixture has. It is
   * enough for the transport layer's tests: what those assert is the route, the
   * authorization and the envelope, none of which depend on where the link is
   * stored.
   */
  async listRelated(
    model: string,
    id: RecordId,
    relationField: string,
    query: ListQuery,
  ): Promise<Page<RecordData>> {
    const metadata = TEST_MODELS.find((candidate) => candidate.name === model) as ModelMetadata
    if (!this.#require(model).some((row) => String(row['id']) === String(id))) {
      throw new RecordNotFoundError(model, id)
    }

    const field = metadata.fields.find((candidate) => candidate.name === relationField)
    if (!field?.relation || field.relation.cardinality !== 'many') {
      throw new FieldNotFoundError(model, relationField, 'Not a to-many relation.')
    }

    const target = field.relation.targetModel
    const inverse = TEST_MODELS.find((candidate) => candidate.name === target)?.fields.find(
      (candidate) =>
        candidate.relation?.name === field.relation?.name && candidate.name !== relationField,
    )
    const key = inverse?.relation?.from ?? 'id'

    const matched = this.#require(target).filter((row) => String(row[key]) === String(id))
    const page = query.page ?? 1
    const perPage = query.perPage ?? 25
    return {
      data: matched.slice((page - 1) * perPage, page * perPage),
      total: matched.length,
      page,
      perPage,
    }
  }

  async attachRelated(
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
  ): Promise<void> {
    await this.#relink(model, id, relationField, targetId, String(id))
  }

  async detachRelated(
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
  ): Promise<void> {
    await this.#relink(model, id, relationField, targetId, null)
  }

  /** Point the child's foreign key at the parent, or clear it. */
  async #relink(
    model: string,
    id: RecordId,
    relationField: string,
    targetId: RecordId,
    value: string | null,
  ): Promise<void> {
    const metadata = TEST_MODELS.find((candidate) => candidate.name === model) as ModelMetadata
    const field = metadata.fields.find((candidate) => candidate.name === relationField)
    if (!field?.relation) throw new FieldNotFoundError(model, relationField)

    const target = field.relation.targetModel
    const child = this.#require(target).find((row) => String(row['id']) === String(targetId))
    if (!child) throw new RecordNotFoundError(target, targetId)

    const inverse = TEST_MODELS.find((candidate) => candidate.name === target)?.fields.find(
      (candidate) => candidate.relation?.name === field.relation?.name,
    )
    ;(child as Record<string, unknown>)[inverse?.relation?.from ?? 'id'] = value
  }

  #require(model: string): RecordData[] {
    const rows = this.#rows.get(model)
    if (!rows) {
      throw new ModelNotFoundError(
        model,
        TEST_MODELS.map((candidate) => candidate.name),
      )
    }
    return rows
  }

  #assertField(model: string, field: string, allowed?: ReadonlySet<string>): void {
    const metadata = TEST_MODELS.find((candidate) => candidate.name === model)
    // A field the caller scoped out is as unknown as one that never existed -
    // which is the answer a hidden column should give.
    if (allowed && !allowed.has(field)) throw new FieldNotFoundError(model, field)
    if (!metadata?.fields.some((candidate) => candidate.name === field)) {
      throw new FieldNotFoundError(model, field)
    }
  }
}

function matches(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case 'eq':
      return actual === expected
    case 'ne':
      return actual !== expected
    case 'contains':
      return typeof actual === 'string' && actual.includes(String(expected))
    case 'startsWith':
      return typeof actual === 'string' && actual.startsWith(String(expected))
    case 'endsWith':
      return typeof actual === 'string' && actual.endsWith(String(expected))
    case 'gt':
      return compare(actual, expected) > 0
    case 'gte':
      return compare(actual, expected) >= 0
    case 'lt':
      return compare(actual, expected) < 0
    case 'lte':
      return compare(actual, expected) <= 0
    case 'in':
      return Array.isArray(expected) && expected.includes(actual)
    default:
      return false
  }
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  return String(a).localeCompare(String(b))
}
