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
 * `users`. Declaring `meta` before `:model` is what keeps it reachable; see
 * the route-collision note in reports/004-http-api.md.
 */
import type { RecordData } from '@nest-admin/core'
import type { ExecutionContext } from '@nestjs/common'
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common'

import { AdminAuthGuard } from '../auth/guard.js'
import { AdminContext } from '../http/execution-context.js'
import { AdminExceptionFilter } from '../http/exception.filter.js'
import { success, successPage, type SuccessResponse } from '../http/response.js'
import type { RawQuery } from '../http/query-parser.js'
import type { MetadataDto } from './metadata.dto.js'
import { AdminService } from './service.js'

@Controller('admin')
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
  @Get('meta')
  async meta(@AdminContext() context: ExecutionContext): Promise<SuccessResponse<MetadataDto>> {
    return success(await this.service.getMetadata(context))
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

  @Patch(':model/:id')
  async update(
    @AdminContext() context: ExecutionContext,
    @Param('model') model: string,
    @Param('id') id: string,
    @Body() body: RecordData,
  ): Promise<SuccessResponse<RecordData>> {
    return success(await this.service.update(context, model, id, body))
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
}
