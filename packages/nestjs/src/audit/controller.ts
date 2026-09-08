/**
 * `/admin/audit` - the trail, and putting an entry back.
 *
 * A literal first segment declared before the controller that owns `:model`,
 * like `meta`, `actions`, `files`, `dev`, `export` and `import`. The cost is
 * the documented one: a model called `audit` would be unreachable.
 *
 * Always registered, and the routes refuse where no store was configured -
 * the same arrangement `files` has, and for the same reason: the store is
 * built from the application's database client, so it arrives from the factory
 * rather than from the outer options, and controllers are decided before any
 * factory has run. The metadata says whether the screen exists, so nothing is
 * offered that cannot work.
 */
import { InvalidQueryError, type AuditAction, type RecordData } from '@nest-admin/core'
import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common'

import { AdminAuthGuard } from '../auth/guard.js'
import { AdminContext } from '../http/execution-context.js'
import { AdminExceptionFilter } from '../http/exception.filter.js'
import type { RawQuery } from '../http/query-parser.js'
import { success, successPage, type SuccessResponse } from '../http/response.js'
import type { ActivityDto } from './contract.js'
import { AuditService, DEFAULT_ACTIVITY_DAYS } from './service.js'
import type { AuditEntryDto } from './dto.js'
import { toActivity, toEntryDto } from './dto.js'

const ACTIONS: ReadonlySet<string> = new Set([
  'create',
  'update',
  'delete',
  'restore',
  'action',
  'import',
  'export',
  'denied',
  'undo',
])

@Controller('audit')
@UseGuards(AdminAuthGuard)
@UseFilters(AdminExceptionFilter)
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * `GET /admin/audit/activity` - the number on the dashboard.
   *
   * Declared before `:id`, so `activity` is matched literally. Its own route
   * rather than a parameter on the list because it answers a different
   * question cheaply: a count and a handful of lines, not a page.
   */
  @Get('activity')
  async activity(
    @AdminContext() context: ExecutionContext,
    @Query('days') days?: string,
  ): Promise<SuccessResponse<ActivityDto>> {
    const window = positive(days) ?? DEFAULT_ACTIVITY_DAYS
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000)

    const [count, page] = await Promise.all([
      this.audit.countSince(context, since),
      this.audit.list(context, { since, page: 1, perPage: 6 }),
    ])

    return success(toActivity(count, window, page.data))
  }

  /**
   * `GET /admin/audit` - a page of the trail, newest first.
   *
   * `model` and `record` together are what the History button on a record
   * asks for. Everything else narrows the whole log.
   */
  @Get()
  async list(
    @AdminContext() context: ExecutionContext,
    @Query() query: RawQuery,
  ): Promise<SuccessResponse<readonly AuditEntryDto[]>> {
    const action = single(query['action'])
    if (action !== undefined && !ACTIONS.has(action)) {
      throw new InvalidQueryError(
        `Unknown audit action "${action}". Known: ${[...ACTIONS].join(', ')}.`,
      )
    }

    const page = await this.audit.list(context, {
      page: positive(single(query['page'])) ?? 1,
      perPage: positive(single(query['perPage'])) ?? 25,
      ...(single(query['model']) === undefined ? {} : { model: single(query['model']) as string }),
      ...(single(query['record']) === undefined
        ? {}
        : { recordId: single(query['record']) as string }),
      ...(action === undefined ? {} : { action: action as AuditAction }),
      ...(single(query['actor']) === undefined ? {} : { actor: single(query['actor']) as string }),
    })

    return successPage(page.data.map(toEntryDto), {
      total: page.total,
      page: page.page,
      perPage: page.perPage,
    })
  }

  @Get(':id')
  async read(
    @AdminContext() context: ExecutionContext,
    @Param('id') id: string,
  ): Promise<SuccessResponse<AuditEntryDto>> {
    return success(toEntryDto(await this.audit.read(context, id)))
  }

  /**
   * `POST /admin/audit/:id/undo` - put it back.
   *
   * A write, and treated as one: it goes through the ordinary update path, so
   * hooks run and the model's own permissions decide. It is refused when the
   * record has moved since - see `AuditService.undo`.
   *
   * Returns the record as it now stands, or `null` where the undo removed it.
   */
  @Post(':id/undo')
  async undo(
    @AdminContext() context: ExecutionContext,
    @Param('id') id: string,
  ): Promise<SuccessResponse<RecordData | null>> {
    return success(await this.audit.undo(context, id))
  }
}

function single(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').at(-1)
  return undefined
}

function positive(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return parsed > 0 ? parsed : undefined
}
