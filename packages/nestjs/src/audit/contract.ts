/**
 * The audit trail, as an application configures it.
 *
 * Core owns the store contract and the entry shape, because neither depends on
 * a framework. This is the half that does: resolving *who* is acting means
 * reading a request, and a request here is a Nest `ExecutionContext`.
 */
import type { AdminAuditOptions, AuditActor } from '@nest-admin/core'
import type { ExecutionContext } from '@nestjs/common'

export interface AdminAuditConfig extends AdminAuditOptions {
  /**
   * Who is acting, when the application owns identity.
   *
   * Unset, the trail reads the account from the built-in login. An admin
   * behind the application's own session has no such account, and this is how
   * it says who is there instead:
   *
   * ```ts
   * actorOf: (context) => {
   *   const user = context.switchToHttp().getRequest().user
   *   return user && { id: user.id, email: user.email, label: user.name }
   * }
   * ```
   *
   * Returning nothing falls back to the built-in account, and then to
   * `Unknown`. An entry is never dropped for want of a name: "something
   * changed and we do not know who" is information, and a missing line is not.
   */
  readonly actorOf?: (context: ExecutionContext) => AuditActor | undefined
}

/** The dashboard's view of recent activity. */
export interface ActivityDto {
  /** How many entries in the window, for the number on the card. */
  readonly count: number
  readonly days: number
  /** The most recent few, already scoped to what this principal may read. */
  readonly recent: readonly ActivityEntryDto[]
}

export interface ActivityEntryDto {
  readonly id: string
  readonly at: string
  readonly actor: string
  readonly action: string
  readonly model: string
  readonly recordId?: string
  readonly recordLabel?: string
  readonly summary: string
}
