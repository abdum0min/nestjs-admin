/**
 * The single generic admin controller.
 *
 * There is deliberately no `UsersController` or `ProductsController`: models
 * are addressed by name at runtime, so one controller serves every model the
 * adapter reports. Generating per-model controllers would put the schema in
 * two places and make the admin unable to follow a schema change without a
 * rebuild.
 *
 * Routes:
 *
 *   GET    /admin/meta
 *   GET    /admin/:model
 *   GET    /admin/:model/:id
 *   POST   /admin/:model
 *   PATCH  /admin/:model/:id
 *   DELETE /admin/:model/:id
 *
 * `:model` is the model name exactly as the adapter reports it - `User`, not
 * `users`. Declaring the literal segments - `meta`, `dashboard`, `actions` -
 * before `:model` is what keeps them reachable: route order decides, so a
 * literal declared afterwards is swallowed by the parameter and answers 404.
 * The cost is that a model of that name would be unreachable.
 */
import { InvalidQueryError, type RecordData, type RecordId } from '@nest-admin/core'
import type { ExecutionContext } from '@nestjs/common'
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common'

import type { AdminActionResult } from '../actions/contract.js'
import { AdminAuthGuard } from '../auth/guard.js'
import { AdminContext } from '../http/execution-context.js'
import { AdminExceptionFilter } from '../http/exception.filter.js'
import { success, successPage, type SuccessResponse } from '../http/response.js'
import type { RawQuery } from '../http/query-parser.js'
import type { MetadataDto } from './metadata.dto.js'
import type { DashboardDto } from '../dashboard/service.js'
import { AdminService, type BulkDeleteResult } from './service.js'

@Controller()
// Guards at controller scope cover every handler below, including `meta`.
// Applied here rather than as an APP_GUARD so the host application's own
// routes keep their own authentication - see auth/guard.ts.
@UseGuards(AdminAuthGuard)
@UseFilters(AdminExceptionFilter)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  /**
   * Declared before `:model` so the literal segment wins. A model named
   * exactly `meta` would be shadowed; Prisma model names are conventionally
   * capitalised (`Meta`) and matching is case-sensitive, so this is a narrow
   * and documented corner.
   */
  /**
   * `POST /admin/actions/:model/:action[/:id]` - run an application action.
   *
   * Under a reserved first segment, and declared before every `:model` route,
   * so `actions` is matched literally. The same arrangement already reserves
   * `meta` here and `assets` in the UI controller; the cost is that a model
   * called `actions` would be unreachable, which is documented rather than
   * guarded against.
   */
  @Post('actions/:model/:action')
  async runListAction(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Param('action') action: string,
  ): Promise<SuccessResponse<AdminActionResult>> {
    return success(await this.service.runAction(context, model, action))
  }

  @Post('actions/:model/:action/:id')
  async runRecordAction(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Param('action') action: string,
    @Param('id') id: string,
  ): Promise<SuccessResponse<AdminActionResult>> {
    return success(await this.service.runAction(context, model, action, id))
  }

  @Get('meta')
  async meta(@AdminContext() context: ExecutionContext): Promise<SuccessResponse<MetadataDto>> {
    return success(await this.service.getMetadata(context))
  }

  /**
   * `GET /admin/dashboard` - what the landing page shows.
   *
   * Declared before `:model` so the literal segment wins, as `meta` and
   * `actions` already are. The cost is the same and is documented with them: a
   * model named `dashboard` would be unreachable.
   */
  @Get('dashboard')
  async dashboard(
    @AdminContext() context: ExecutionContext,
  ): Promise<SuccessResponse<DashboardDto>> {
    return success(await this.service.getDashboard(context))
  }

  @Get(':model')
  async list(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Query() query: RawQuery,
  ): Promise<SuccessResponse<readonly RecordData[]>> {
    const page = await this.service.list(context, model, query)
    return successPage(page.data, { total: page.total, page: page.page, perPage: page.perPage })
  }

  @Get(':model/:id')
  async findOne(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Param('id') id: string,
  ): Promise<SuccessResponse<RecordData>> {
    return success(await this.service.findOne(context, model, id))
  }

  @Post(':model')
  async create(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Body() body: RecordData,
  ): Promise<SuccessResponse<RecordData>> {
    return success(await this.service.create(context, model, body))
  }

  /**
   * `PATCH /admin/:model/:id` - change one record.
   *
   * `x-admin-version` carries the value the record's updated-at column held
   * when the caller read it. A header rather than a key in the body: the body
   * is validated field by field against the schema, and a reserved key there
   * would collide with a model that happens to have a column of that name.
   *
   * Ignored unless the admin is configured with `concurrency: 'optimistic'`.
   */
  @Patch(':model/:id')
  async update(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Param('id') id: string,
    @Body() body: RecordData,
    @Headers('x-admin-version') version?: string,
  ): Promise<SuccessResponse<RecordData>> {
    return success(await this.service.update(context, model, id, body, version))
  }

  /**
   * Returns 200 with a `null` payload rather than 204, so every admin endpoint
   * answers with the same envelope and a client needs one response shape.
   */
  @Delete(':model/:id')
  async remove(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Param('id') id: string,
  ): Promise<SuccessResponse<null>> {
    await this.service.delete(context, model, id)
    return success(null)
  }

  /**
   * `DELETE /admin/:model` with `{ "ids": [...] }` - delete several records.
   *
   * One segment, so it cannot be confused with `/:model/:id`. The ids are in
   * the body rather than the query string because a selection of two hundred
   * would not survive a URL length limit, and a request that silently deletes
   * the first N of what was asked for is worse than one that fails.
   *
   * Answers 200 with both lists even when some records survived; see
   * `deleteMany` for why a partial result is not an error.
   */
  @Delete(':model')
  async removeMany(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Body() body: { ids?: unknown },
  ): Promise<SuccessResponse<BulkDeleteResult>> {
    const ids: unknown = body?.ids
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' && typeof id !== 'number')) {
      throw new InvalidQueryError(
        'Deleting records requires a body of the form { "ids": ["...", "..."] }.',
      )
    }

    return success(await this.service.deleteMany(context, model, ids as RecordId[]))
  }

  /**
   * `GET /admin/:model/:id/:relation` - a page of related records.
   *
   * Three segments, so it cannot be confused with `/:model/:id`. The query
   * string is the ordinary list query and describes the records being returned,
   * not the record they hang off.
   */
  @Get(':model/:id/:relation')
  async listRelated(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Param('id') id: string,
    @Param('relation') relation: string,
    @Query() query: RawQuery,
  ): Promise<SuccessResponse<readonly RecordData[]>> {
    const page = await this.service.listRelated(context, model, id, relation, query)
    return successPage(page.data, { total: page.total, page: page.page, perPage: page.perPage })
  }

  /**
   * `POST /admin/:model/:id/:relation` with `{ "id": "..." }` - link a record.
   *
   * The body carries only an id: this attaches something that already exists.
   * Creating a record and linking it in one request is a different operation
   * and is not this one.
   */
  @Post(':model/:id/:relation')
  async attachRelated(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Param('id') id: string,
    @Param('relation') relation: string,
    @Body() body: { id?: unknown },
  ): Promise<SuccessResponse<null>> {
    const targetId = body?.id
    if (typeof targetId !== 'string' && typeof targetId !== 'number') {
      throw new InvalidQueryError(
        'Attaching a related record requires a body of the form { "id": "..." }.',
      )
    }

    await this.service.attachRelated(context, model, id, relation, targetId)
    return success(null)
  }

  /** `DELETE /admin/:model/:id/:relation/:targetId` - unlink, without deleting. */
  @Delete(':model/:id/:relation/:targetId')
  async detachRelated(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Param('id') id: string,
    @Param('relation') relation: string,
    @Param('targetId') targetId: string,
  ): Promise<SuccessResponse<null>> {
    await this.service.detachRelated(context, model, id, relation, targetId)
    return success(null)
  }
}
