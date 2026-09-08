/**
 * `/admin/pages/:path` - the body of a page built from widgets.
 *
 * A literal first segment declared before the controller that owns `:model`,
 * like `meta`, `actions`, `files`, `dev`, `audit`, `export` and `import`. The
 * cost is the documented one: a model called `pages` would be unreachable.
 *
 * Only `widgets` pages are served from here. A `module` page fetches from the
 * application's own API, and an `url` page is a document this admin never
 * reads - neither has a body this package could serve, and inventing an empty
 * one for them would make "nothing to fetch" indistinguishable from "failed to
 * load".
 *
 * Always registered, and refusing where no page matches, for the same reason
 * the audit routes are: pages arrive from the factory, and controllers are
 * decided before any factory has run.
 */
import {
  Controller,
  Get,
  Param,
  UseFilters,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common'

import { AdminAuthGuard } from '../auth/guard.js'
import type { DashboardDto } from '../dashboard/service.js'
import { AdminContext } from '../http/execution-context.js'
import { AdminExceptionFilter } from '../http/exception.filter.js'
import { success, type SuccessResponse } from '../http/response.js'
import { PagesService } from './service.js'

@Controller('pages')
@UseGuards(AdminAuthGuard)
@UseFilters(AdminExceptionFilter)
export class AdminPagesController {
  constructor(private readonly pages: PagesService) {}

  /**
   * `GET /admin/pages/:path`
   *
   * The page's own `can` is asked here, not only when the sidebar was drawn.
   * A link that was never rendered is not a permission - the URL is typeable,
   * and this is the check that matters.
   */
  @Get(':path')
  async body(
    @AdminContext() context: ExecutionContext,
    @Param('path') path: string,
  ): Promise<SuccessResponse<DashboardDto>> {
    return success(await this.pages.body(context, path))
  }
}
