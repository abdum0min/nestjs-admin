/**
 * Custom pages, resolved for the principal asking.
 *
 * Two questions, and they are deliberately separate:
 *
 * - **Which pages are there?** Answered in the metadata document, so the
 *   sidebar is drawn from one request like everything else in it. That half
 *   lives in `visible.ts`, because the admin service needs it too.
 * - **What is on this one?** Answered here, when the page is opened, and only
 *   for a `widgets` page - a `module` page fetches its own data, and an `url`
 *   page is a document this admin never reads.
 *
 * Splitting them is what keeps a page cheap: ten pages cost ten titles in the
 * metadata document and nothing else until somebody opens one.
 */
import { ForbiddenError, ModelNotFoundError } from '@nest-admin/core'
import { Inject, Injectable, Optional, type ExecutionContext } from '@nestjs/common'

import { AdminService } from '../admin/service.js'
import type { DashboardDto } from '../dashboard/service.js'
import { ADMIN_PAGES } from '../tokens.js'
import { isWidgetPage, type AdminPages } from './contract.js'
import { pageAllowed } from './visible.js'

@Injectable()
export class PagesService {
  constructor(
    private readonly admin: AdminService,
    @Optional() @Inject(ADMIN_PAGES) private readonly pages: AdminPages | undefined,
  ) {}

  /**
   * The body of one `widgets` page.
   *
   * `ModelNotFoundError` when the path names nothing - which is what a stale
   * bookmark to a removed page produces, and it should read as "gone" rather
   * than as a failure.
   *
   * A `module` or `url` page has no server body: it was never this admin's
   * content to serve, and saying so is more honest than an empty widget list,
   * which looks exactly like a page that failed to load.
   */
  async body(context: ExecutionContext, path: string): Promise<DashboardDto> {
    const page = (this.pages ?? []).find((candidate) => candidate.path === path)

    if (page === undefined) {
      throw gone(`No page at "${path}".`)
    }

    if (!(await pageAllowed(page, context))) {
      throw new ForbiddenError()
    }

    if (!isWidgetPage(page)) {
      throw gone(`The page at "${path}" draws itself; there is nothing here to fetch.`)
    }

    return this.admin.resolveWidgets(context, page.widgets)
  }
}

/**
 * A 404 in the admin's own envelope, worded for a page.
 *
 * `ModelNotFoundError` is the right *kind* - "you asked for a screen this admin
 * does not have" - and Core's error vocabulary says in its own header to resist
 * growing the taxonomy unless a caller needs to branch on the difference. No
 * caller does: a page and a model are both 404 here.
 *
 * What is wrong is only the wording, because that class builds its message from
 * a model name. Passing a sentence as the name produced `Unknown model "The
 * page at "reports" draws itself..."`, so the message is replaced. A Nest
 * `NotFoundException` was the other option and would have answered in a
 * different response shape than every other route in this admin.
 */
function gone(message: string): ModelNotFoundError {
  const error = new ModelNotFoundError('')
  error.message = message
  return error
}
