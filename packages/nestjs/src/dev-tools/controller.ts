/**
 * `/admin/dev` - the developer tools.
 *
 * Registered before `AdminController`, like every other literal segment, so
 * `dev` is never read as a model name. The same guard and the same exception
 * filter as everything else: these routes are part of the admin, not a side
 * door into it.
 *
 * They exist only when the application imported `@nest-admin/nestjs/dev-tools`
 * and passed the result to `AdminModule`. A build that did not has no
 * controller to register - the routes are absent rather than disabled, which is
 * a stronger promise than any flag.
 */
import { InvalidQueryError } from '@nest-admin/core'
import {
  Body,
  Controller,
  Get,
  Post,
  UseFilters,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common'

import { AdminAuthGuard } from '../auth/guard.js'
import { AdminContext } from '../http/execution-context.js'
import { AdminExceptionFilter } from '../http/exception.filter.js'
import { success, type SuccessResponse } from '../http/response.js'
import { DevToolsService, type Draft, type RunResult } from './service.js'

interface GenerateBody {
  readonly model?: unknown
  readonly count?: unknown
  readonly seed?: unknown
  readonly images?: unknown
}

interface FillBody {
  readonly perModel?: unknown
  readonly seed?: unknown
  readonly images?: unknown
}

/** A body value the caller may have typed. Anything unusable becomes absent. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function flag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function required(value: unknown, what: string): string {
  const found = text(value)
  if (found === undefined) throw new InvalidQueryError(`"${what}" is required.`)
  return found
}

@Controller('dev')
@UseGuards(AdminAuthGuard)
@UseFilters(AdminExceptionFilter)
export class DevToolsController {
  constructor(private readonly service: DevToolsService) {}

  /** What is available: which models, whether faker is installed, the last run. */
  @Get()
  async status(@AdminContext() context: ExecutionContext): Promise<SuccessResponse<unknown>> {
    return success(await this.service.status(context))
  }

  /** What would be written. Writes nothing. */
  @Post('preview')
  async preview(
    @AdminContext() context: ExecutionContext,
    @Body() body: GenerateBody,
  ): Promise<SuccessResponse<Draft>> {
    return success(
      await this.service.preview(context, {
        model: required(body?.model, 'model'),
        ...(count(body?.count) === undefined ? {} : { count: count(body?.count) as number }),
        ...(text(body?.seed) === undefined ? {} : { seed: text(body?.seed) as string }),
      }),
    )
  }

  @Post('generate')
  async generate(
    @AdminContext() context: ExecutionContext,
    @Body() body: GenerateBody,
  ): Promise<SuccessResponse<RunResult>> {
    return success(
      await this.service.generate(context, {
        model: required(body?.model, 'model'),
        ...(count(body?.count) === undefined ? {} : { count: count(body?.count) as number }),
        ...(text(body?.seed) === undefined ? {} : { seed: text(body?.seed) as string }),
        ...(flag(body?.images) === undefined ? {} : { images: flag(body?.images) as boolean }),
      }),
    )
  }

  /** Every model, in an order the relations allow. The headline button. */
  @Post('fill')
  async fill(
    @AdminContext() context: ExecutionContext,
    @Body() body: FillBody,
  ): Promise<SuccessResponse<readonly RunResult[]>> {
    return success(
      await this.service.fill(context, {
        ...(count(body?.perModel) === undefined
          ? {}
          : { perModel: count(body?.perModel) as number }),
        ...(text(body?.seed) === undefined ? {} : { seed: text(body?.seed) as string }),
        ...(flag(body?.images) === undefined ? {} : { images: flag(body?.images) as boolean }),
      }),
    )
  }

  /** Delete what the last run created, and nothing else. */
  @Post('undo')
  async undo(
    @AdminContext() context: ExecutionContext,
  ): Promise<SuccessResponse<readonly RunResult[]>> {
    return success(await this.service.undo(context))
  }

  @Post('truncate')
  async truncate(
    @AdminContext() context: ExecutionContext,
    @Body() body: { model?: unknown },
  ): Promise<SuccessResponse<{ deleted: number; remaining: number }>> {
    return success(await this.service.truncate(context, required(body?.model, 'model')))
  }
}
