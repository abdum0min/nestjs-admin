/**
 * The resource authorization boundary.
 *
 * Phase 4 gave the host a say over whether a *request* may enter the admin at
 * all (`AdminAuth`). This answers a narrower question: may this principal touch
 * *this model*, for *this operation*?
 *
 * The two are deliberately separate contracts. A host that only needs "staff
 * only" implements `AdminAuth` and stops; a host that needs "support can read
 * Users but nobody outside finance sees Payment" adds this one. Folding them
 * together would force every consumer to think about resources whether or not
 * they have per-resource rules.
 *
 * Why this exists at all: a host can already deny per model from `AdminAuth`,
 * because the guard sees `params.model`. But `GET /admin/meta` has no `:model`
 * segment, so route-level checks cannot stop the metadata endpoint from
 * describing every table in the database - and the admin UI renders itself from
 * that endpoint. Resource authorization has to live where metadata is produced.
 */
import type { ExecutionContext } from '@nestjs/common'

/**
 * What the caller is trying to do.
 *
 * `'metadata'` is the odd one out: it is not an operation on records, it asks
 * whether the model should be *visible* to this principal at all. A model that
 * fails a `'metadata'` check disappears from `GET /admin/meta` entirely.
 */
export type AdminOperation =
  | 'metadata'
  | 'list'
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  /**
   * An application-defined action.
   *
   * Distinct from `update` because an action can do anything, including things
   * no CRUD route offers, so a policy should be able to decide about it
   * separately. A policy written before actions existed does not recognise the
   * value and denies it, which is the right direction to fail in.
   */
  | 'action'

/** Everything the policy is given to decide with. */
export interface ResourceAuthorization {
  /**
   * The NestJS execution context for the request being served. Use it to reach
   * whatever principal the host application attached to the request - exactly
   * as in `AdminAuth.authorize`, so one accessor works for both contracts.
   */
  readonly context: ExecutionContext
  /** The model name as the schema declares it, e.g. `User`. */
  readonly model: string
  readonly operation: AdminOperation
}

/**
 * Implemented by the consuming application and passed to
 * `AdminModule.forRoot({ resourceAuth })`.
 *
 * ```ts
 * const resourceAuth: AdminResourceAuth = {
 *   authorize({ context, model, operation }) {
 *     const { user } = context.switchToHttp().getRequest()
 *     if (model === 'AuditLog') return user.isAdmin
 *     if (operation === 'delete') return user.isAdmin
 *     return true
 *   },
 * }
 * ```
 */
export interface AdminResourceAuth {
  /**
   * Decide whether this principal may perform `operation` on `model`.
   *
   * Return `true`, or return nothing, to allow. To deny, return `false` or
   * throw `ForbiddenError`. Both are treated identically - unlike
   * `AdminAuth`, there is no 401/403 ambiguity to resolve here, because a
   * request that reached this point has already passed authentication.
   *
   * The consequence of a denial depends on the operation:
   *
   * - `'metadata'` - the model is **omitted** from `GET /admin/meta`. It is not
   *   an error; the response simply describes a smaller schema.
   * - everything else - the request fails with `403 FORBIDDEN`, and the ORM
   *   adapter is never called.
   *
   * Anything else thrown is treated as a bug in the host's policy: the request
   * fails with a generic 500 and the real error is logged. A failing policy
   * never allows access.
   *
   * May be synchronous or asynchronous.
   */
  authorize(resource: ResourceAuthorization): void | boolean | Promise<void | boolean>
}

/**
 * The default when `resourceAuth` is omitted: every model is visible and every
 * operation permitted.
 *
 * Unlike `auth`, this default is not a hole. `auth` is still required, so the
 * door is already shut; omitting `resourceAuth` only means "everyone who gets
 * in sees everything", which is exactly the behaviour before this option
 * existed. Making it required would break every existing consumer to express a
 * rule most applications do not have.
 */
export function allowAllResources(): AdminResourceAuth {
  return {
    authorize(): true {
      return true
    },
  }
}
