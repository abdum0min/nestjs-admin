/**
 * The guard that enforces the admin authentication boundary.
 *
 * It contains no authentication logic of its own. Its entire job is to call
 * the `AdminAuth` the consuming application supplied and translate the outcome
 * into something the exception filter can map.
 *
 * It is attached to the admin controller with `@UseGuards`, never registered
 * as an `APP_GUARD`. A library that installs a global guard would start
 * authenticating the host application's own routes - the same reasoning that
 * kept the exception filter off `APP_FILTER` in Phase 3.
 */
import { ForbiddenError } from '@nest-admin/core'
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'

import { ADMIN_AUTH } from '../tokens.js'
import type { AdminAuth } from './contract.js'

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Inject(ADMIN_AUTH) private readonly auth: AdminAuth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Errors thrown by `authorize` are intentionally not caught. `Unauthorized`
    // and `Forbidden` are the documented way to deny, and the filter maps them
    // to 401 and 403. Anything else the host throws is a bug in the host's auth
    // code, and the filter turns it into a generic 500 without echoing its
    // message - so a stray error cannot become an accidental allow, nor leak.
    const decision = await this.auth.authorize(context)

    // `void` means allowed. `false` is accepted as a denial so a guard written
    // in the reflexive NestJS style fails closed; see AdminAuth.authorize.
    if (decision === false) {
      throw new ForbiddenError()
    }

    return true
  }
}
