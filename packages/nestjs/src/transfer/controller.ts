/**
 * `/admin/export` and `/admin/import`.
 *
 * Two literal first segments, registered before the controller that owns
 * `:model` - the same arrangement that already reserves `meta`, `actions`,
 * `files` and `dev`, and at the same documented cost: a model called `export`
 * or `import` would be unreachable.
 *
 * ## Why the file arrives as a raw body
 *
 * An import file is text and can be a megabyte. The host application's JSON
 * body parser has a hundred-kilobyte default, and this module cannot change it -
 * it belongs to the application, not to the admin. So the file is sent as
 * `text/csv` or `text/plain`, which that parser ignores, and read off the
 * request stream directly with its own limit. The options travel in the query
 * string, where they are a few hundred bytes.
 *
 * ## Why the file is sent three times
 *
 * Inspect, dry-run, apply - and each of them uploads it again. The alternative
 * is holding the upload on the server between requests, which means a handle,
 * an expiry, and memory that grows with every import somebody abandoned
 * halfway. For a file capped at a thousand rows, sending it again is cheaper
 * than any of that, and the server keeps no state at all.
 */
import { InvalidQueryError } from '@nest-admin/core'
import {
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UseFilters,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common'
import { Readable } from 'node:stream'

import { AdminAuthGuard } from '../auth/guard.js'
import { AdminContext } from '../http/execution-context.js'
import { AdminExceptionFilter } from '../http/exception.filter.js'
import { success, type SuccessResponse } from '../http/response.js'
import type { RawQuery } from '../http/query-parser.js'
import { previewOf, type ImportOutcome, type ImportPlan, type ImportShape } from './contract.js'
import { MAX_IMPORT_BYTES, TransferService } from './service.js'

@Controller()
@UseGuards(AdminAuthGuard)
@UseFilters(AdminExceptionFilter)
export class AdminTransferController {
  constructor(private readonly transfer: TransferService) {}

  /**
   * `GET /admin/export/:model` - the current view as a file.
   *
   * The list parameters are the ordinary ones, so the URL that produced the
   * screen produces the file: whatever was filtered, searched and sorted is
   * what comes out. `format`, `columns`, `delimiter` and `bom` are this route's
   * own.
   */
  @Get('export/:model')
  @Header('Cache-Control', 'no-store')
  async exportModel(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Query() query: RawQuery,
  ): Promise<StreamableFile> {
    const { format, columns, delimiter, bom, list } = readExportQuery(query)

    const file = await this.transfer.exportFile(
      context,
      model,
      { format, ...(columns === undefined ? {} : { columns }), delimiter, bom },
      list,
    )

    return new StreamableFile(Readable.from(file.body, { objectMode: false }), {
      type: file.type,
      disposition: `attachment; filename="${file.filename}"`,
    })
  }

  /** `POST /admin/import/:model/columns` - what is in this file. */
  @Post('import/:model/columns')
  async describe(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Req() request: unknown,
  ): Promise<SuccessResponse<ImportShape>> {
    return success(await this.transfer.describe(context, model, await body(request)))
  }

  /** `POST /admin/import/:model/plan` - what an import would do, doing none of it. */
  @Post('import/:model/plan')
  async plan(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Query() query: RawQuery,
    @Req() request: unknown,
  ): Promise<SuccessResponse<ImportPlan>> {
    const plan = await this.transfer.plan(context, model, {
      body: await body(request),
      ...readImportQuery(query),
    })

    return success(previewOf(plan))
  }

  /** `POST /admin/import/:model` - do it. */
  @Post('import/:model')
  async apply(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Query() query: RawQuery,
    @Req() request: unknown,
  ): Promise<SuccessResponse<ImportOutcome>> {
    return success(
      await this.transfer.apply(context, model, {
        body: await body(request),
        ...readImportQuery(query),
      }),
    )
  }
}

/**
 * Read the request body as text, refusing it the moment it grows too large.
 *
 * Counted as the chunks arrive, like an upload: a client that ignores the limit
 * should not be able to make the process hold the whole file before being told
 * no.
 */
async function body(request: unknown): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of request as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength
    if (total > MAX_IMPORT_BYTES) {
      throw new InvalidQueryError(
        `This file is larger than the ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB import limit.`,
      )
    }
    chunks.push(Buffer.from(chunk))
  }

  if (total === 0) throw new InvalidQueryError('The request carried no file.')

  return Buffer.concat(chunks).toString('utf8')
}

interface ExportQuery {
  readonly format: 'csv' | 'json'
  readonly columns?: readonly string[]
  readonly delimiter: string
  readonly bom: boolean
  /** What is left for the list query parser, which refuses anything it does not know. */
  readonly list: RawQuery
}

function readExportQuery(query: RawQuery): ExportQuery {
  const format = single(query['format']) ?? 'csv'
  if (format !== 'csv' && format !== 'json') {
    throw new InvalidQueryError(`Unknown export format "${format}". Use csv or json.`)
  }

  const delimiter = single(query['delimiter']) ?? ','
  if (delimiter !== ',' && delimiter !== ';' && delimiter !== '\t') {
    throw new InvalidQueryError('The delimiter has to be a comma, a semicolon or a tab.')
  }

  const columns = single(query['columns'])
    ?.split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')

  const list: RawQuery = { ...query }
  for (const own of ['format', 'columns', 'delimiter', 'bom']) delete list[own]

  return {
    format,
    ...(columns === undefined || columns.length === 0 ? {} : { columns }),
    delimiter,
    bom: single(query['bom']) !== 'false',
    list,
  }
}

function readImportQuery(query: RawQuery): {
  readonly mapping: Readonly<Record<string, string>>
  readonly matchBy?: string
} {
  const raw = single(query['mapping']) ?? ''
  const mapping: Record<string, string> = {}

  // `field:column,field:column`. A column name containing a comma or a colon
  // would break this, so the value is sent percent-encoded and decoded here -
  // spreadsheet headers contain worse than commas.
  for (const pair of raw.split(',')) {
    if (pair === '') continue
    const at = pair.indexOf(':')
    if (at < 1) throw new InvalidQueryError(`"${pair}" is not a field:column pair.`)
    mapping[decode(pair.slice(0, at))] = decode(pair.slice(at + 1))
  }

  const matchBy = single(query['matchBy'])

  return { mapping, ...(matchBy === undefined || matchBy === '' ? {} : { matchBy }) }
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function single(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').at(-1)
  return undefined
}
