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
import type { FilterRule } from '@nest-admin/core'
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
/**
 * Which *rows* a principal may touch, rather than whether it may touch the
 * model at all.
 *
 * Returned from {@link AdminResourceAuth.authorize} instead of `true` when the
 * answer is "yes, but only some of them". The filters are merged into the query
 * the adapter runs, exactly as if the caller had typed them into the URL.
 *
 * ## Why a filter and not a check on the way out
 *
 * Fetching a page and then discarding the rows this principal may not see would
 * be simpler and wrong in four ways at once: `total` would count rows nobody is
 * allowed to know about, a page of 25 would show 3, "next page" would sometimes
 * be empty, and a large table would be read in full to return a handful. The
 * database has to do the filtering, so the constraint has to reach it.
 *
 * ## An empty list means unscoped
 *
 * `{ filters: [] }` and `true` mean the same thing. That matters because a
 * policy that builds its filters conditionally should not have to remember to
 * return a different type when it built none.
 */
export interface AdminScope {
  /**
   * Combined with the caller's own filters using AND, and with any other scope
   * that applies. There is no OR: two scopes both apply, they do not compete.
   */
  readonly filters: readonly FilterRule[]
}

/**
 * What a policy may answer.
 *
 * `void` and `true` allow; `false` denies; an {@link AdminScope} allows a
 * subset. Widening this from `void | boolean` was backward compatible - an
 * implementation returning a boolean still satisfies it, and a truthy object
 * already meant "allow", so nothing changed meaning.
 */
export type ResourceDecision = void | boolean | AdminScope

/** The filters a decision carries, and whether it allowed anything at all. */
export function readDecision(decision: ResourceDecision): {
  readonly allowed: boolean
  readonly filters: readonly FilterRule[]
} {
  if (decision === false) return { allowed: false, filters: [] }
  if (decision === true || decision === undefined || decision === null) {
    return { allowed: true, filters: [] }
  }

  const filters = (decision as AdminScope).filters
  // A policy that returns some other object is allowing the request - that is
  // what a truthy return has always meant - and simply scoping nothing.
  return { allowed: true, filters: Array.isArray(filters) ? filters : [] }
}

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
  authorize(resource: ResourceAuthorization): ResourceDecision | Promise<ResourceDecision>
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
