/**
 * Roles, as a shorthand for a policy.
 *
 * Most applications that need more than one administrator need the same thing:
 * a handful of named roles, each allowed a list of operations on a list of
 * models. Writing that as an `AdminResourceAuth` function is not hard, but
 * everyone writes the same function, and everyone gets to make the same
 * mistakes in it.
 *
 * ## This is sugar, and deliberately nothing more
 *
 * `roles` compiles into an `AdminResourceAuth` and then disappears. There is
 * still exactly one enforcement path - the same one that existed before roles
 * did - so a rule expressed as a role and a rule expressed as a function are
 * checked by identical code. A second enforcement path would be a second place
 * for a permission to be missed.
 *
 * It also means an application that outgrows roles is not stuck: it writes the
 * function, and everything it already relies on keeps working.
 *
 * ## Not configuring roles changes nothing
 *
 * No `roles`, no behaviour change: the module supplies the permissive policy it
 * always did. Roles are for the admin that has grown a second person, and the
 * admin that has not should not have to know they exist.
 */
import type { FilterRule } from '@nest-admin/core'
import type { ExecutionContext } from '@nestjs/common'

import {
  readDecision,
  type AdminOperation,
  type AdminResourceAuth,
  type ResourceDecision,
} from './resource.js'

/**
 * Something a role may do that is not about a model.
 *
 * A closed list, for the reason every closed list in this package is closed: a
 * typo in an open string would silently grant nothing, and nothing is exactly
 * what a working configuration also looks like from the outside.
 */
export type AdminCapability = 'manageTeam'

export interface RolePermissions {
  /**
   * Model name to the operations this role may perform on it.
   *
   * A model that is not listed is not merely read-only - it is **invisible**.
   * It fails the `metadata` check, so it never reaches `GET /admin/meta` and
   * the interface never learns it exists.
   *
   * `'*'` allows every operation, including `action`. Actions are not implied
   * by `update`: an action runs application code and can do anything, so a role
   * that may edit a post has not thereby been given permission to publish it.
   */
  readonly models?: Readonly<Record<string, readonly AdminOperation[] | '*'>>

  /** Things this role may do that are not about a model. */
  readonly capabilities?: readonly AdminCapability[]

  /**
   * Which rows, for the models this role can reach.
   *
   * Called once per model per request. Return nothing to leave that model
   * unscoped. The filters are ANDed with anything the caller asked for, and
   * reach the database - see `AdminScope`.
   */
  readonly scope?: (args: {
    readonly context: ExecutionContext
    readonly model: string
  }) => readonly FilterRule[] | undefined
}

/** `'*'` is the role that may do everything - what a lone administrator has. */
export type RoleDefinition = '*' | RolePermissions

export type AdminRoles = Readonly<Record<string, RoleDefinition>>

/**
 * Which role is making this request.
 *
 * Returning nothing denies everything. That is the safe direction: a request
 * that reached the admin without a recognisable role is one nobody decided
 * about, and deciding for it is not this package's business.
 *
 * One role, not several. Two roles would have to be combined, and combining
 * their *scopes* needs OR - which `ListQuery.filters` cannot express, because
 * they are ANDed. Supporting it properly means changing the adapter contract,
 * so it is deferred rather than half-implemented.
 */
export type RoleResolver = (context: ExecutionContext) => string | undefined

function allows(definition: RoleDefinition, model: string, operation: AdminOperation): boolean {
  if (definition === '*') return true

  const declared = definition.models?.[model]
  if (declared === undefined) return false
  if (declared === '*') return true

  // `metadata` is not an operation on records: a role that may do anything at
  // all with a model must be able to see that the model exists, or it would be
  // granted permissions on something the interface never shows it.
  if (operation === 'metadata') return declared.length > 0

  return declared.includes(operation)
}

/**
 * Turn a role table into the policy the rest of the admin already understands.
 *
 * Everything below this line is the ordinary resource-authorization path.
 */
export function rolesToResourceAuth(roles: AdminRoles, roleOf: RoleResolver): AdminResourceAuth {
  return {
    authorize({ context, model, operation }): ResourceDecision {
      const name = roleOf(context)
      if (name === undefined) return false

      const definition = roles[name]
      // A role nobody defined is not a role. Denying is the only safe reading:
      // the alternative is that a typo in `roleOf` quietly grants everything.
      if (definition === undefined) return false

      if (!allows(definition, model, operation)) return false

      const filters = definition === '*' ? undefined : definition.scope?.({ context, model })
      return filters && filters.length > 0 ? { filters } : true
    },
  }
}

/** Whether the current request's role holds a capability. */
export function capabilityChecker(
  roles: AdminRoles | undefined,
  roleOf: RoleResolver | undefined,
): (context: ExecutionContext, capability: AdminCapability) => boolean {
  // No roles configured means every administrator is a superuser, which is what
  // an admin without roles has always been. Refusing here would take away a
  // screen from everyone who never asked for roles.
  if (roles === undefined || roleOf === undefined) return () => true

  return (context, capability) => {
    const name = roleOf(context)
    const definition = name === undefined ? undefined : roles[name]
    if (definition === undefined) return false
    if (definition === '*') return true
    return definition.capabilities?.includes(capability) === true
  }
}

/**
 * Both policies must agree.
 *
 * Used when an application supplies `roles` *and* its own `resourceAuth` - the
 * roles cover the ordinary cases and the function handles the one model that
 * does not fit. Combining with AND is the fail-closed direction: adding a rule
 * can only ever remove access, never grant it, so neither policy can be
 * surprised by the other.
 *
 * Scopes concatenate for the same reason. Two scopes both apply; they do not
 * compete.
 */
export function combineResourceAuth(
  first: AdminResourceAuth,
  second: AdminResourceAuth,
): AdminResourceAuth {
  return {
    async authorize(resource): Promise<ResourceDecision> {
      const a = readDecision(await first.authorize(resource))
      if (!a.allowed) return false

      const b = readDecision(await second.authorize(resource))
      if (!b.allowed) return false

      const filters = [...a.filters, ...b.filters]
      return filters.length > 0 ? { filters } : true
    },
  }
}
