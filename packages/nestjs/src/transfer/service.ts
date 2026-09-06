/**
 * Taking data out, and putting data in.
 *
 * ## Both directions reuse the admin, rather than reaching past it
 *
 * An export pages through `AdminService.list`, so the caller's filters, the
 * policy's row scope, the field projection and the soft-delete view are the
 * ones already in force on the screen it was started from. An import calls
 * `create` and `update`, so hooks run, read-only columns are refused and every
 * permission is checked - by the same code that checks them for a form.
 *
 * That is the opposite of the mock-data generator, which deliberately writes
 * through the adapter: a seeder inventing two hundred users must not send two
 * hundred welcome emails. An import is a person entering real records, and
 * their `beforeCreate` is exactly what should decide what a record means.
 *
 * ## Nothing is written until somebody has seen what would happen
 *
 * `plan` does the whole import except the writing: it parses, maps, coerces,
 * resolves relations and looks up which rows already exist, then reports what
 * it found. There is no transaction across an import - the adapter contract has
 * none - so a failure halfway through leaves the rows before it written. The
 * dry run is what makes that acceptable: the errors are known before the first
 * write rather than discovered during the four hundredth.
 */
import {
  ForbiddenError,
  InvalidQueryError,
  ModelNotFoundError,
  softDeleteFieldOf,
  type FilterRule,
  type ListQuery,
  type ModelMetadata,
  type ModelOverrides,
  type OrmAdapter,
  type RecordData,
  type RecordId,
} from '@nest-admin/core'
import { Inject, Injectable, Logger, type ExecutionContext } from '@nestjs/common'

import { AdminService } from '../admin/service.js'
import type { AdminCapability } from '../auth/roles.js'
import type { RawQuery } from '../http/query-parser.js'
import { ADMIN_ADAPTER, ADMIN_CAPABILITIES, ADMIN_MODELS, ADMIN_SERVICE } from '../tokens.js'
import { cellOf, exportColumns, importTargets, matchableFields, suggestMapping } from './columns.js'
import type { ExportColumn, ImportTarget } from './columns.js'
import { coerce } from './coerce.js'
import { csvHeader, csvRow, parseCsv } from './csv.js'
import type {
  ExportRequest,
  ImportOutcome,
  ImportPlan,
  ImportRequest,
  ImportShape,
  PlannedRow,
} from './contract.js'

/**
 * How many rows one import may carry.
 *
 * An import runs inside the request that started it, and every row goes through
 * the application's own hooks - which may hash a password or call something
 * over the network. Ten thousand of those is a request nobody's proxy will wait
 * for, and a timeout halfway through an import is the worst outcome available:
 * the work is half done and the answer never arrives.
 *
 * A larger migration is a script's job, and a script has the adapter.
 */
export const MAX_IMPORT_ROWS = 1000

/**
 * How many rows one export may produce.
 *
 * Checked against the total *before* anything is sent, because a stream cannot
 * change its mind: once the first bytes are out the status code is decided, and
 * a file that stops early looks exactly like a file that finished.
 */
export const MAX_EXPORT_ROWS = 50_000

/** The largest import file that will be read, before it is even parsed. */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024

/** Rows fetched per round trip while exporting. */
const EXPORT_PAGE = 500

/** Values per `in` clause when looking up existing rows or relation targets. */
const LOOKUP_CHUNK = 200

/** Only the parameters the list query parser knows; anything else it refuses. */
const LIST_PARAMETERS = ['search', 'sort', 'filter', 'deleted'] as const

@Injectable()
export class TransferService {
  constructor(
    @Inject(ADMIN_SERVICE) private readonly admin: AdminService,
    @Inject(ADMIN_ADAPTER) private readonly adapter: OrmAdapter,
    @Inject(ADMIN_CAPABILITIES)
    private readonly can: (context: ExecutionContext, capability: AdminCapability) => boolean,
    @Inject(ADMIN_MODELS) private readonly overrides: ModelOverrides | undefined,
  ) {}

  private readonly logger = new Logger('NestAdmin')

  /* ---------------------------------------------------------------- export */

  /**
   * Everything the caller's current view contains, as a file.
   *
   * Returns the file name and an async iterable of text chunks. The controller
   * turns that into a stream, so a fifty-thousand-row export never exists in
   * memory as one string.
   */
  async exportFile(
    context: ExecutionContext,
    modelName: string,
    request: ExportRequest,
    raw: RawQuery,
  ): Promise<{
    readonly filename: string
    readonly type: string
    readonly body: AsyncIterable<string>
  }> {
    this.assertMayExport(context)

    const model = await this.requireModel(modelName)
    await this.admin.authorize(context, modelName, 'list')

    const columns = this.chosenColumns(model, await this.admin.schema(), request.columns)
    const query = listParameters(raw)

    // Strings: these go through the same query parser a URL does, and it reads
    // its numbers out of text.
    const first = await this.admin.list(context, modelName, {
      ...query,
      page: '1',
      perPage: String(EXPORT_PAGE),
    })

    if (first.total > MAX_EXPORT_ROWS) {
      throw new InvalidQueryError(
        `This export would contain ${first.total.toLocaleString('en-US')} records, and the limit is ` +
          `${MAX_EXPORT_ROWS.toLocaleString('en-US')}. Narrow the view with a filter or a search first.`,
      )
    }

    this.logger.log(
      `Exporting ${first.total} ${modelName} record${first.total === 1 ? '' : 's'} as ${request.format}.`,
    )

    const stamp = new Date().toISOString().slice(0, 10)

    return {
      filename: `${modelName}-${stamp}.${request.format}`,
      type:
        request.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      body:
        request.format === 'csv'
          ? this.csvBody(context, modelName, query, columns, first.data, request)
          : this.jsonBody(context, modelName, query, columns, first.data),
    }
  }

  private async *csvBody(
    context: ExecutionContext,
    modelName: string,
    query: RawQuery,
    columns: readonly ExportColumn[],
    first: readonly RecordData[],
    request: ExportRequest,
  ): AsyncIterable<string> {
    const options = { delimiter: request.delimiter ?? ',', bom: request.bom !== false }

    yield csvHeader(
      columns.map((column) => column.name),
      options,
    )

    for await (const record of this.everyRecord(context, modelName, query, first)) {
      yield csvRow(
        columns.map((column) => cellOf(record, column)),
        options,
      )
    }
  }

  /**
   * JSON, written a record at a time.
   *
   * Assembled by hand rather than with one `JSON.stringify` at the end, for the
   * same reason the CSV is: the point of streaming is that the whole result
   * never has to fit anywhere.
   */
  private async *jsonBody(
    context: ExecutionContext,
    modelName: string,
    query: RawQuery,
    columns: readonly ExportColumn[],
    first: readonly RecordData[],
  ): AsyncIterable<string> {
    yield '[\n'

    let written = 0
    for await (const record of this.everyRecord(context, modelName, query, first)) {
      const row: Record<string, unknown> = {}
      for (const column of columns) {
        const value = cellOf(record, column)
        row[column.name] = value instanceof Date ? value.toISOString() : (value ?? null)
      }

      yield (written === 0 ? '  ' : ',\n  ') + JSON.stringify(row)
      written += 1
    }

    yield '\n]\n'
  }

  /**
   * Every record the view contains, one page at a time.
   *
   * Through `AdminService.list`, so the policy's scope, the field projection
   * and the deleted view are applied by the code that already owns them. The
   * first page is passed in because the row count had to be known before any
   * of this could start.
   */
  private async *everyRecord(
    context: ExecutionContext,
    modelName: string,
    query: RawQuery,
    first: readonly RecordData[],
  ): AsyncIterable<RecordData> {
    yield* first
    if (first.length < EXPORT_PAGE) return

    for (let page = 2; ; page += 1) {
      const next = await this.admin.list(context, modelName, {
        ...query,
        page: String(page),
        perPage: String(EXPORT_PAGE),
      })

      yield* next.data
      if (next.data.length < EXPORT_PAGE) return
    }
  }

  private chosenColumns(
    model: ModelMetadata,
    schema: readonly ModelMetadata[],
    chosen: readonly string[] | undefined,
  ): readonly ExportColumn[] {
    const available = exportColumns(model, schema)
    if (chosen === undefined || chosen.length === 0) return available

    const unknown = chosen.filter((name) => !available.some((column) => column.name === name))
    if (unknown.length > 0) {
      throw new InvalidQueryError(
        `"${model.name}" has no exportable column named ${unknown.map((name) => `"${name}"`).join(', ')}.`,
      )
    }

    // Ordered as the caller asked, not as the schema declares: they chose the
    // columns, so they chose the order.
    return chosen.map((name) => available.find((column) => column.name === name) as ExportColumn)
  }

  /* ---------------------------------------------------------------- import */

  /**
   * What a file contains, and which field each column probably belongs to.
   *
   * The first step of an import, and the only one that touches no data: the
   * screen needs the column names to draw the mapping, and a suggestion good
   * enough that most files need no correcting.
   */
  async describe(context: ExecutionContext, modelName: string, body: string): Promise<ImportShape> {
    const model = await this.requireImportableModel(context, modelName)
    const targets = importTargets(model, await this.admin.schema(), this.overrides)
    const { columns, rows } = readFile(body)

    return {
      columns: [...columns],
      rows: rows.length,
      truncated: rows.length > MAX_IMPORT_ROWS,
      targets: [...targets],
      matchable: [...matchableFields(model)],
      mapping: suggestMapping(columns, targets),
      sample: rows.slice(0, 5).map((row) => ({ ...row })),
    }
  }

  /** Everything an import would do, having done none of it. */
  async plan(
    context: ExecutionContext,
    modelName: string,
    request: ImportRequest,
  ): Promise<ImportPlan> {
    const model = await this.requireImportableModel(context, modelName)
    const targets = importTargets(model, await this.admin.schema(), this.overrides)
    const { columns, rows } = readFile(request.body)

    if (rows.length === 0) throw new InvalidQueryError('This file has no rows.')
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new InvalidQueryError(
        `This file has ${rows.length.toLocaleString('en-US')} rows and the limit is ` +
          `${MAX_IMPORT_ROWS.toLocaleString('en-US')}. Split it, or use a script and the ORM directly.`,
      )
    }

    const mapping = this.checkedMapping(request.mapping, columns, targets)
    const match = this.checkedMatch(model, columns, request.matchBy, mapping)

    const mapped = [...Object.keys(mapping)]
      .map((field) => targets.find((target) => target.field === field))
      .filter((target): target is ImportTarget => target !== undefined)

    const coerced = rows.map((row, index) => this.coerceRow(row, mapping, mapped, index + 2, match))
    await this.resolveRelations(context, coerced, mapped)
    await this.matchExisting(context, model, coerced, match, mapping)

    const planned = coerced.map(finish)

    return {
      matchBy: match?.field ?? null,
      mapping,
      create: planned.filter((row) => row.action === 'create').length,
      update: planned.filter((row) => row.action === 'update').length,
      refused: planned.filter((row) => row.action === 'refused').length,
      rows: planned,
    }
  }

  /**
   * Do it.
   *
   * The plan is recomputed here rather than carried over from the dry run,
   * because the request that showed somebody a plan and the request that
   * applies it are two requests, and anything remembered between them is state
   * that can be stale, forged or missing. Recomputing is a few hundred
   * milliseconds and removes the whole question.
   *
   * Rows that were refused by the plan are skipped and reported; the rest are
   * written one at a time, and a failure is recorded rather than thrown - one
   * bad row must not discard the nine hundred that worked.
   */
  async apply(
    context: ExecutionContext,
    modelName: string,
    request: ImportRequest,
  ): Promise<ImportOutcome> {
    const plan = await this.plan(context, modelName, request)

    let created = 0
    let updated = 0
    const failed: { line: number; message: string }[] = []

    for (const row of plan.rows) {
      if (row.action === 'refused') {
        failed.push({ line: row.line, message: row.problems.join(' ') })
        continue
      }

      try {
        if (row.action === 'create') {
          await this.admin.create(context, modelName, { ...row.values })
          created += 1
        } else {
          await this.admin.update(context, modelName, row.id as RecordId, { ...row.values })
          updated += 1
        }
      } catch (cause) {
        failed.push({ line: row.line, message: messageOf(cause) })
      }
    }

    this.logger.log(
      `Imported into ${modelName}: ${created} created, ${updated} updated, ${failed.length} failed.`,
    )

    return { created, updated, failed }
  }

  /* --------------------------------------------------------------- details */

  /**
   * Turn one file row into values, without touching the database.
   *
   * A relation whose cell holds a name rather than a key is left as a `lookup`
   * for `resolveRelations` to settle in one query per relation, instead of one
   * query per row.
   */
  private coerceRow(
    row: Readonly<Record<string, string>>,
    mapping: Readonly<Record<string, string>>,
    targets: readonly ImportTarget[],
    line: number,
    match: Match | undefined,
  ): Draft {
    const values: RecordData = {}
    const lookups: { field: string; text: string }[] = []
    const problems: string[] = []

    for (const target of targets) {
      const column = mapping[target.field] as string
      const result = coerce(target, row[column])

      if (result.kind === 'problem') problems.push(`${target.field}: ${result.problem}`)
      else if (result.kind === 'lookup') lookups.push({ field: target.field, text: result.text })
      else values[target.field] = result.value
    }

    // The cell that decides create-or-update. Read here, where the file row is,
    // and settled in one query for the whole file by `matchExisting`.
    const found = match === undefined ? '' : (row[match.column] ?? '').trim()

    return {
      line,
      values,
      lookups,
      problems,
      action: 'create',
      ...(found === '' ? {} : { match: found }),
    }
  }

  /**
   * Turn a cell reading `Ada Vasquez` into a foreign key.
   *
   * One query per relation rather than one per row - a thousand-row file with
   * an author column is one `in` clause, not a thousand round trips.
   *
   * A value that matches an existing key is taken as a key. Only if it does not
   * is it looked up by the target's display column, and **two rows sharing that
   * name refuse the import row** rather than picking one. Guessing here writes a
   * post to the wrong Ada, and nothing about the result would look wrong.
   */
  private async resolveRelations(
    context: ExecutionContext,
    rows: readonly Draft[],
    targets: readonly ImportTarget[],
  ): Promise<void> {
    for (const target of targets) {
      const relation = target.relation
      if (relation === undefined) continue

      const wanted = new Set<string>()
      for (const row of rows) {
        for (const lookup of row.lookups) if (lookup.field === target.field) wanted.add(lookup.text)
      }
      if (wanted.size === 0) continue

      let readable = true
      try {
        await this.admin.authorize(context, relation.model, 'list')
      } catch {
        readable = false
      }

      const byKey = readable
        ? await this.lookup(context, relation.model, relation.to, [...wanted])
        : new Map<string, readonly RecordData[]>()
      const byName = readable
        ? await this.lookup(context, relation.model, relation.display, [...wanted])
        : new Map<string, readonly RecordData[]>()

      for (const row of rows) {
        for (const lookup of row.lookups) {
          if (lookup.field !== target.field) continue

          const key = byKey.get(lookup.text)
          if (key?.length === 1) {
            row.values[target.field] = (key[0] as RecordData)[relation.to]
            continue
          }

          const named = byName.get(lookup.text) ?? []
          if (named.length === 1) {
            row.values[target.field] = (named[0] as RecordData)[relation.to]
            continue
          }

          row.problems.push(
            named.length > 1
              ? `${target.field}: ${named.length} ${relation.model} records are called "${lookup.text}". ` +
                  `Use the ${relation.to} instead so there is one answer.`
              : !readable
                ? `${target.field}: you may not read ${relation.model}, so "${lookup.text}" cannot be resolved.`
                : `${target.field}: no ${relation.model} with ${relation.to} or ${relation.display} "${lookup.text}".`,
          )
        }
      }
    }
  }

  /**
   * Decide, per row, whether it is a create or an update.
   *
   * One `in` query for the whole file. A value that matches nothing is a
   * create; a value that matches more than one record refuses the row, which
   * can happen when the match column is not actually unique in the database.
   */
  private async matchExisting(
    context: ExecutionContext,
    model: ModelMetadata,
    rows: readonly Draft[],
    match: Match | undefined,
    mapping: Readonly<Record<string, string>>,
  ): Promise<void> {
    if (match === undefined) return

    const key = model.primaryKey[0] as string
    const wanted = rows
      .map((row) => row.match)
      .filter((value): value is string => value !== undefined)

    const found = await this.lookup(context, model.name, match.field, [...new Set(wanted)])

    for (const row of rows) {
      // An empty match cell is an ordinary new record: a file of new customers
      // has no ids yet, and the database is about to supply them.
      if (row.match === undefined) continue

      const matches = found.get(row.match) ?? []
      if (matches.length === 0) continue

      if (matches.length > 1) {
        row.problems.push(
          `${match.field} "${row.match}" matches ${matches.length} existing records, so this row cannot say which one to update.`,
        )
        continue
      }

      row.action = 'update'
      row.id = (matches[0] as RecordData)[key] as RecordId

      // The value that found the record does not need writing back onto it, and
      // for a generated key it could not be written at all.
      if (mapping[match.field] === undefined) delete row.values[match.field]
    }
  }

  /**
   * Find records by one column, in chunks, within this principal's scope.
   *
   * Through the adapter rather than `AdminService.list`, because the question is
   * `field in (...)` and the list route speaks a query string. The two things
   * the service would have added are added here: the policy's row scope, and
   * the soft-delete filter - an import must not resurrect a deleted row by
   * updating it, and must not fail to create one because a deleted record holds
   * the email address.
   */
  private async lookup(
    context: ExecutionContext,
    modelName: string,
    field: string,
    values: readonly string[],
  ): Promise<ReadonlyMap<string, readonly RecordData[]>> {
    const found = new Map<string, RecordData[]>()
    if (values.length === 0) return found

    const model = (await this.admin.schema()).find((candidate) => candidate.name === modelName)
    if (model === undefined) return found

    const scope = await this.admin.authorize(context, modelName, 'list')
    const key = model.primaryKey[0] as string
    const deleted = softDeleteFieldOf(this.overrides, modelName)

    for (let index = 0; index < values.length; index += LOOKUP_CHUNK) {
      const chunk = values.slice(index, index + LOOKUP_CHUNK)

      const filters: FilterRule[] = [
        { field, operator: 'in', value: chunk },
        ...scope,
        ...(deleted === undefined
          ? []
          : [{ field: deleted, operator: 'eq' as const, value: null }]),
      ]

      const query: ListQuery = {
        page: 1,
        perPage: chunk.length * 2,
        filters,
        // The soft-delete column belongs here as well as in the filters: the
        // field scope is what a query is allowed to touch, and a filter on a
        // column left out of it is refused rather than ignored.
        fields: [key, field, ...(deleted === undefined ? [] : [deleted])],
      }

      for (const record of (await this.adapter.list(modelName, query)).data) {
        const value = record[field]
        if (value === null || value === undefined) continue

        const at = String(value instanceof Date ? value.toISOString() : value)
        const existing = found.get(at)
        if (existing) existing.push(record)
        else found.set(at, [record])
      }
    }

    return found
  }

  private checkedMapping(
    mapping: Readonly<Record<string, string>> | undefined,
    columns: readonly string[],
    targets: readonly ImportTarget[],
  ): Readonly<Record<string, string>> {
    const entries = Object.entries(mapping ?? {}).filter(([, column]) => column !== '')
    if (entries.length === 0) {
      throw new InvalidQueryError('Map at least one column onto a field before importing.')
    }

    for (const [field, column] of entries) {
      if (!targets.some((target) => target.field === field)) {
        throw new InvalidQueryError(`"${field}" is not a field this import can write.`)
      }
      if (!columns.includes(column)) {
        throw new InvalidQueryError(`This file has no column called "${column}".`)
      }
    }

    return Object.fromEntries(entries)
  }

  /**
   * Which column decides whether a row already exists.
   *
   * Absent means every row is a create, which is what an import of new records
   * is. It has to be a unique column and it has to be present in the file: a
   * match on something the rows do not carry would silently create everything.
   */
  private checkedMatch(
    model: ModelMetadata,
    columns: readonly string[],
    matchBy: string | undefined,
    mapping: Readonly<Record<string, string>>,
  ): Match | undefined {
    if (matchBy === undefined || matchBy === '') return undefined

    if (!matchableFields(model).includes(matchBy)) {
      throw new InvalidQueryError(
        `"${matchBy}" is not unique on ${model.name}, so it cannot identify a record to update.`,
      )
    }

    // Which column carries it. The mapping cannot answer for a primary key -
    // that is generated, so it is not a field an import may write and never
    // appears there - and the primary key is the obvious thing to match on.
    const column = mapping[matchBy] ?? columns.find((name) => same(name, matchBy))

    if (column === undefined) {
      throw new InvalidQueryError(
        `This file has no "${matchBy}" column, so it cannot say which records to update.`,
      )
    }

    return { field: matchBy, column }
  }

  private async requireImportableModel(
    context: ExecutionContext,
    modelName: string,
  ): Promise<ModelMetadata> {
    const model = await this.requireModel(modelName)

    // Both, because an import that can only create is still an import, and one
    // that can only update is too - but a principal allowed neither has no
    // business reading this file into a plan.
    const may = await Promise.allSettled([
      this.admin.authorize(context, modelName, 'create'),
      this.admin.authorize(context, modelName, 'update'),
    ])
    if (may.every((result) => result.status === 'rejected')) throw new ForbiddenError()

    return model
  }

  /**
   * Resolve a model name, or answer 404 the way every other route does.
   *
   * Structural before authorization, for the reason the admin service states at
   * length: a model that is not part of this admin is not one somebody merely
   * lacks access to, and the two must not look the same from outside.
   */
  private async requireModel(modelName: string): Promise<ModelMetadata> {
    const models = await this.admin.schema()
    const found = models.find((candidate) => candidate.name === modelName)

    if (found === undefined) {
      throw new ModelNotFoundError(
        modelName,
        models.map((candidate) => candidate.name),
      )
    }

    return found
  }

  /**
   * The capability gate on taking data out.
   *
   * Reading a list a page at a time and downloading the whole table are not the
   * same act, even though the second is only the first repeated: one is somebody
   * working, the other is the entire customer table on a laptop. Without roles
   * every administrator has it, which is what a single-superuser admin always
   * meant. With roles it has to be granted.
   */
  private assertMayExport(context: ExecutionContext): void {
    if (!this.can(context, 'exportData')) {
      throw new ForbiddenError('This role may not export data.')
    }
  }
}

/** Which field identifies an existing record, and which column carries it. */
interface Match {
  readonly field: string
  readonly column: string
}

/** A row on its way from a file to the database. */
interface Draft {
  readonly line: number
  readonly values: RecordData
  readonly lookups: readonly { readonly field: string; readonly text: string }[]
  problems: string[]
  action: 'create' | 'update'
  id?: RecordId
  match?: string
}

function finish(draft: Draft): PlannedRow {
  return {
    line: draft.line,
    action: draft.problems.length > 0 ? 'refused' : draft.action,
    ...(draft.id === undefined ? {} : { id: draft.id }),
    values: draft.values,
    problems: draft.problems,
  }
}

/**
 * A file as columns and rows of text, whichever of the two formats it is.
 *
 * JSON is accepted as an array of objects, which is what this admin exports and
 * what every other tool produces. The columns are the union of the keys, in the
 * order they are first seen, so a file whose second object carries a field the
 * first omitted does not lose it.
 */
function readFile(body: string): {
  readonly columns: readonly string[]
  readonly rows: readonly Readonly<Record<string, string>>[]
} {
  const text = body.trim()
  if (text === '') throw new InvalidQueryError('This file is empty.')

  if (text.startsWith('[') || text.startsWith('{')) return readJson(text)

  const parsed = parseCsv(body)
  const header = parsed[0]
  if (header === undefined) throw new InvalidQueryError('This file is empty.')

  const columns = header.map((name, index) =>
    name.trim() === '' ? `column ${index + 1}` : name.trim(),
  )

  const rows = parsed.slice(1).map((cells) => {
    const row: Record<string, string> = {}
    columns.forEach((column, index) => (row[column] = cells[index] ?? ''))
    return row
  })

  return { columns, rows }
}

function readJson(text: string): {
  readonly columns: readonly string[]
  readonly rows: readonly Readonly<Record<string, string>>[]
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new InvalidQueryError(`This is not valid JSON: ${messageOf(cause)}`)
  }

  const list = Array.isArray(parsed) ? parsed : [parsed]
  const columns: string[] = []
  const rows: Record<string, string>[] = []

  for (const entry of list) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new InvalidQueryError('A JSON import has to be an array of objects, one per record.')
    }

    const row: Record<string, string> = {}
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (!columns.includes(key)) columns.push(key)
      row[key] =
        value === null || value === undefined
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value)
    }
    rows.push(row)
  }

  return { columns, rows }
}

/** The list parameters, and nothing else - the parser refuses what it does not know. */
function listParameters(raw: RawQuery): RawQuery {
  const query: RawQuery = {}
  for (const name of LIST_PARAMETERS) if (raw[name] !== undefined) query[name] = raw[name]
  return query
}

/** Two names a person would call the same thing: `created_at` and `createdAt`. */
function same(one: string, other: string): boolean {
  const flatten = (name: string): string => name.toLowerCase().replaceAll(/[\s_-]+/g, '')
  return flatten(one) === flatten(other)
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
