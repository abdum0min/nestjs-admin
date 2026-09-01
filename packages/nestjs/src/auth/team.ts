/**
 * Managing the people who can open the admin.
 *
 * ## Why this is a screen of its own and not a model
 *
 * The account table is deliberately excluded from `resources`, and must stay
 * excluded. As an ordinary model resource, anyone with `update` on it could
 * write another account's `passwordHash` directly - a complete takeover
 * reachable from a form, with no password ever being typed.
 *
 * This is the opposite arrangement. It never accepts a hash; it accepts a
 * password and derives one. And it holds invariants a generic resource cannot
 * express, all of them about the one failure that cannot be repaired from
 * inside the product - an administrator removing their own access:
 *
 *   - you cannot delete your own account
 *   - you cannot disable your own account
 *   - you cannot change your own role
 *
 * Those three are the whole protection, and that is not an accident of what was
 * easy to write. A guard against "removing the last account that can manage the
 * team" was written first and then removed, because it could never fire: the
 * account making the request is signed in, so it is enabled and holds the
 * capability, and the three rules above mean it is never the account being
 * removed. It always survives its own check. Dead safety code is worse than
 * none - it advertises a protection that is not there.
 *
 * Every rule is checked here, on the server. The interface hides the controls
 * too, but hiding a control has never been a permission.
 *
 * ## What is deliberately not defended against
 *
 * Someone who already holds `manageTeam` can create another account that holds
 * it. That is not an escalation - they are already an administrator - but it is
 * **persistence**: a stolen session can outlive the password change that was
 * meant to end it. The mitigation is that `manageTeam` is a capability a role
 * has to name, so it can be withheld, and the answer to a compromise is still
 * to look at who exists.
 */
import {
  ForbiddenError,
  RecordNotFoundError,
  ValidationError,
  summarise,
  type AdminAccount,
  type AdminAccountStore,
  type AdminAccountSummary,
} from '@nest-admin/core'
import type { ExecutionContext } from '@nestjs/common'

import { hashAdminPassword } from './password.js'
import type { AdminCapability, AdminRoles } from './roles.js'

/** The shortest password this will accept. Not a policy - a floor. */
const MIN_PASSWORD = 10

export interface TeamMember extends AdminAccountSummary {
  readonly disabled: boolean
  /** True for the account making the request, so the interface can say so. */
  readonly isYou: boolean
}

export interface TeamView {
  readonly members: readonly TeamMember[]
  /** False when the store can list but not write; the screen is then read-only. */
  readonly writable: boolean
  /** Role names the interface offers, in the order they were declared. */
  readonly roles: readonly string[]
}

export interface TeamInput {
  readonly store: AdminAccountStore
  readonly roles: AdminRoles | undefined
  readonly can: (context: ExecutionContext, capability: AdminCapability) => boolean
  readonly accountOf: (context: ExecutionContext) => AdminAccountSummary | undefined
}

const writable = (store: AdminAccountStore): boolean =>
  typeof store.createAccount === 'function' &&
  typeof store.updateAccount === 'function' &&
  typeof store.deleteAccount === 'function'

/** Available at all only with a built-in login whose store can list accounts. */
export function teamAvailable(store: AdminAccountStore | undefined): boolean {
  return typeof store?.listAccounts === 'function'
}

export class TeamService {
  constructor(private readonly input: TeamInput) {}

  async list(context: ExecutionContext): Promise<TeamView> {
    this.assertMayManage(context)

    const you = this.input.accountOf(context)
    const accounts = (await this.input.store.listAccounts?.()) ?? []

    return {
      members: accounts.map((account) => ({
        ...summarise(account),
        disabled: account.disabled === true,
        isYou: account.id === you?.id,
      })),
      writable: writable(this.input.store),
      roles: Object.keys(this.input.roles ?? {}),
    }
  }

  async create(
    context: ExecutionContext,
    body: { email?: unknown; name?: unknown; role?: unknown; password?: unknown },
  ): Promise<TeamMember> {
    this.assertMayManage(context)
    const create = this.assertWritable().createAccount!

    const email = this.readEmail(body.email)
    const password = this.readPassword(body.password)
    const role = this.readRole(body.role)
    const name =
      typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : undefined

    // Derived here, never accepted. A route that took a hash would let whoever
    // reached it install a password it already knew.
    const account = await create({
      email,
      passwordHash: await hashAdminPassword(password),
      ...(name !== undefined ? { name } : {}),
      ...(role !== undefined ? { role } : {}),
    })

    return this.toMember(account, context)
  }

  async update(
    context: ExecutionContext,
    id: string,
    body: { name?: unknown; role?: unknown; disabled?: unknown; password?: unknown },
  ): Promise<TeamMember> {
    this.assertMayManage(context)
    const update = this.assertWritable().updateAccount!

    const target = await this.require(id)
    const you = this.input.accountOf(context)
    const isSelf = target.id === you?.id

    const changes: {
      name?: string
      role?: string
      disabled?: boolean
      passwordHash?: string
    } = {}

    if (typeof body.name === 'string') changes.name = body.name.trim()

    if (body.role !== undefined) {
      // Changing your own role is how an administrator demotes themselves by
      // accident and cannot undo it - there is nobody left who could.
      if (isSelf) throw new ValidationError('You cannot change your own role.', ['role'])
      changes.role = this.readRole(body.role) ?? undefined
    }

    if (body.disabled !== undefined) {
      if (typeof body.disabled !== 'boolean') {
        throw new ValidationError('`disabled` must be true or false.', ['disabled'])
      }
      if (isSelf && body.disabled) {
        throw new ValidationError('You cannot disable your own account.', ['disabled'])
      }
      changes.disabled = body.disabled
    }

    if (body.password !== undefined) {
      changes.passwordHash = await hashAdminPassword(this.readPassword(body.password))
    }

    if (Object.keys(changes).length === 0) return this.toMember(target, context)

    return this.toMember(await update(id, changes), context)
  }

  async remove(context: ExecutionContext, id: string): Promise<void> {
    this.assertMayManage(context)
    const remove = this.assertWritable().deleteAccount!

    const target = await this.require(id)
    if (target.id === this.input.accountOf(context)?.id) {
      throw new ValidationError('You cannot delete your own account.')
    }

    await remove(id)
  }

  /* ---------------------------------------------------------------- rules */

  private assertMayManage(context: ExecutionContext): void {
    if (!this.input.can(context, 'manageTeam')) throw new ForbiddenError()
  }

  private assertWritable(): AdminAccountStore {
    if (!writable(this.input.store)) {
      throw new ForbiddenError('This account store is read-only.')
    }
    return this.input.store
  }

  private async require(id: string): Promise<AdminAccount> {
    const account = await this.input.store.findById(id)
    if (account === null) throw new RecordNotFoundError('AdminAccount', id)
    return account
  }

  private readEmail(value: unknown): string {
    if (typeof value !== 'string' || !value.includes('@') || value.trim().length < 3) {
      throw new ValidationError('A valid email address is required.', ['email'])
    }
    // Lower-cased on the way in, because that is how the store looks it up:
    // someone who was added as `Ada@example.com` will type `ada@` eventually.
    return value.trim().toLowerCase()
  }

  private readPassword(value: unknown): string {
    if (typeof value !== 'string' || value.length < MIN_PASSWORD) {
      throw new ValidationError(`A password of at least ${MIN_PASSWORD} characters is required.`, [
        'password',
      ])
    }
    return value
  }

  private readRole(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new ValidationError('Invalid role.', ['role'])

    const roles = this.input.roles
    // A role that is not declared grants nothing, so storing one would produce
    // an account that can sign in and then see nothing, with no clue why.
    if (roles !== undefined && !(value in roles)) {
      throw new ValidationError(`"${value}" is not one of the roles this admin declares.`, ['role'])
    }
    return value
  }

  private toMember(account: AdminAccount, context: ExecutionContext): TeamMember {
    return {
      ...summarise(account),
      disabled: account.disabled === true,
      isYou: account.id === this.input.accountOf(context)?.id,
    }
  }
}
