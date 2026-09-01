/**
 * `/admin/team` - the built-in team screen's routes.
 *
 * Guarded like every other route that returns data, and declared **before**
 * `AdminController` so `team` is never read as a model name. That ordering is
 * the same rule `meta`, `dashboard`, `actions` and `assets` already rely on,
 * and it costs the same thing: a model called `team` would be unreachable.
 *
 * The routes answer 404 rather than 403 when the admin is not using the
 * built-in login, or its store cannot list accounts. There is nothing to
 * forbid - the feature does not exist for that deployment, and saying so as a
 * denial would suggest it might exist for somebody else.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseFilters,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common'

import { AdminContext } from '../http/execution-context.js'
import { AdminExceptionFilter } from '../http/exception.filter.js'
import { success, type SuccessResponse } from '../http/response.js'
import { AdminAuthGuard } from './guard.js'
import type { TeamMember, TeamService, TeamView } from './team.js'
import { ADMIN_TEAM } from '../tokens.js'

@Controller('team')
@UseGuards(AdminAuthGuard)
@UseFilters(AdminExceptionFilter)
export class AdminTeamController {
  constructor(@Inject(ADMIN_TEAM) private readonly team: TeamService | undefined) {}

  @Get()
  async list(@AdminContext() context: ExecutionContext): Promise<SuccessResponse<TeamView>> {
    return success(await this.service().list(context))
  }

  @Post()
  async create(
    @AdminContext() context: ExecutionContext,
    @Body() body: Record<string, unknown>,
  ): Promise<SuccessResponse<TeamMember>> {
    return success(await this.service().create(context, body))
  }

  @Patch(':id')
  async update(
    @AdminContext() context: ExecutionContext,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<SuccessResponse<TeamMember>> {
    return success(await this.service().update(context, id, body))
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @AdminContext() context: ExecutionContext,
    @Param('id') id: string,
  ): Promise<SuccessResponse<{ id: string }>> {
    await this.service().remove(context, id)
    return success({ id })
  }

  private service(): TeamService {
    if (this.team === undefined) {
      // Not a `ForbiddenError`: for this deployment the routes are not part of
      // the admin at all, which is a 404 in the same way an excluded model is.
      throw new NotFoundException()
    }
    return this.team
  }
}
