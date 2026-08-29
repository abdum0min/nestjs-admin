/**
 * The admin authentication boundary.
 *
 * Nest Admin does not authenticate anyone. The consuming application already
 * has an identity system - sessions, JWTs, an API gateway, mTLS, whatever it
 * is - and a framework that invented a second one would be adding a security
 * surface, not removing one.
 *
 * So the contract is a single decision: *may this request reach the admin?*
 * Everything about how identity was established stays in the host application.
 *
 * Nothing here inspects a header, a cookie, or a token, and nothing here knows
 * what a user is.
 */
import { ForbiddenError, UnauthorizedError } from '@nest-admin/core'
import { Logger, type ExecutionContext } from '@nestjs/common'

/**
 * Implemented by the consuming application and passed to
 * `AdminModule.forRoot({ auth })`.
 *
 * ```ts
 * const auth: AdminAuth = {
 *   authorize(context) {
 *     const request = context.switchToHttp().getRequest()
 *     if (!request.user) throw new UnauthorizedError()
 *     if (!request.user.isStaff) throw new ForbiddenError()
 *   },
 * }
 * ```
 */
export interface AdminAuth {
  /**
   * Decide whether the request may proceed.
   *
   * Return (or resolve) normally to allow it. To deny it, throw:
   *
   * - {@link UnauthorizedError} - no identity was established. 401.
   * - {@link ForbiddenError} - an identity exists but may not do this. 403.
   *
   * Throwing is the intended way to deny, because it forces the caller to say
   * *which* denial it is. A client cannot act on "denied"; it can act on "log
   * in" versus "you may not do this".
   *
   * Returning `false` is also treated as a denial, mapped to `403`, so a guard
   * written in the reflexive NestJS style still fails closed rather than
   * silently allowing the request. Prefer throwing: `false` cannot express the
   * 401/403 distinction, and 403 is only the safer of the two guesses.
   *
   * May be synchronous or asynchronous.
   *
   * @param context The NestJS execution context. Use it to reach the request -
   *   including any principal the host application already attached, and the
   *   `model` route parameter on per-model routes.
   */
  authorize(context: ExecutionContext): void | boolean | Promise<void | boolean>
}

const logger = new Logger('NestAdmin')

/**
 * An {@link AdminAuth} that permits every request. **The admin API becomes
 * completely public.**
 *
 * It exists because `auth` is required, and a required option with no escape
 * hatch pushes people toward writing their own always-allow implementation -
 * which is the same hole, only invisible in review. This one is deliberately
 * hard to mistake for anything else: the name says `unsafe`, and it logs a
 * warning every time an application starts with it.
 *
 * Intended for local development, examples and tests. Never for a deployed
 * application.
 */
export function unsafeAllowAllRequests(): AdminAuth {
  const auth: AdminAuth = {
    authorize(): void {
      // Nothing. That is the point, and why the name says so.
    },
  }
  unsafeInstances.add(auth)
  return auth
}

/**
 * Instances produced by {@link unsafeAllowAllRequests}.
 *
 * A `WeakSet` rather than a marker property on the object: nothing is added to
 * the public shape of `AdminAuth`, a consumer cannot set the flag by accident
 * or on purpose, and the entry disappears with the instance.
 */
const unsafeInstances = new WeakSet<AdminAuth>()

/** Warn loudly when an application boots with authentication disabled. */
export function warnIfUnsafe(auth: AdminAuth): void {
  if (unsafeInstances.has(auth)) {
    logger.warn(
      'AdminModule is running with unsafeAllowAllRequests(): every admin route, ' +
        'including /admin/meta, is public. Do not deploy this.',
    )
  }
}
