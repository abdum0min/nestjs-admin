/**
 * Admin accounts, in Prisma.
 *
 * ## A model of its own
 *
 * The default is `AdminAccount`, and that default is the design rather than a
 * placeholder. The people who administer a system are usually not rows in the
 * table they administer, and pointing this at the application's `User` would
 * mean every customer record carries a password that opens the admin - which is
 * a decision nobody makes on purpose and several people make by accident.
 *
 * The model name is configurable because some applications already have a
 * `Staff` or an `Operator`. Pointing it at `User` is possible and is a choice,
 * not a default.
 *
 * ## What it does not do
 *
 * Create, update, delete. The store contract is read-only, and this implements
 * only what it declares: an admin that could mint its own administrators is an
 * escalation waiting for its first mistake in a policy. Seeding the first
 * account is the application's job, with `hashAdminPassword`.
 *
 * ## The account model should not be a resource
 *
 * Nothing here can arrange that - which models the admin exposes is the
 * module's business - so it is the one thing a consumer has to remember:
 *
 * ```ts
 * resources: { exclude: ['AdminAccount'] }
 * ```
 *
 * Without it, anyone who may edit that model can grant themselves whatever the
 * admin can do. `builtInAuth` warns at startup when it sees the account model
 * among the exposed resources.
 */
import type { AdminAccount, AdminAccountStore } from '@nest-admin/core'

import { resolveDelegate } from '../client/delegate.js'

export interface PrismaAccountStoreOptions {
  /** A constructed Prisma Client - the same one the adapter is given. */
  readonly client: unknown

  /** The model holding admin accounts. `AdminAccount` by default. */
  readonly model?: string

  /**
   * Column names, where they differ from the defaults.
   *
   * A mapping rather than a required schema: an application that already has a
   * `Staff` table with `login` and `hash` should not have to migrate it to use
   * this.
   */
  readonly fields?: {
    readonly id?: string
    readonly email?: string
    readonly name?: string
    readonly passwordHash?: string
    readonly disabled?: string
    /** Written on a successful sign-in, when the column exists. */
    readonly lastLoginAt?: string
  }
}

const DEFAULTS = {
  id: 'id',
  email: 'email',
  name: 'name',
  passwordHash: 'passwordHash',
  disabled: 'disabled',
  lastLoginAt: 'lastLoginAt',
} as const

export function prismaAccountStore(options: PrismaAccountStoreOptions): AdminAccountStore {
  const model = options.model ?? 'AdminAccount'
  const column = { ...DEFAULTS, ...options.fields }

  /*
   * The allowlist is the one configured name.
   *
   * `resolveDelegate` takes a list because the adapter resolves a model named
   * by a *request*, where an allowlist is the whole defence. Here the name
   * comes from the application's own configuration and there is nothing to
   * defend against - but passing it anyway keeps the property-name guard
   * inside `resolveDelegate`, which is the part that still matters, and gives
   * a clear error rather than `undefined.findMany is not a function` when the
   * model does not exist.
   */
  const delegate = () => resolveDelegate(options.client, model, [model])

  /**
   * A row as the contract describes it.
   *
   * Returns `null` for a row with no usable hash rather than an account that
   * can never sign in. The difference matters at the point of use: a `null`
   * takes the same path as an unknown email, and an account object with an
   * empty hash would be compared against and fail in a way that takes a
   * measurably different amount of time.
   */
  const toAccount = (row: unknown): AdminAccount | null => {
    if (typeof row !== 'object' || row === null) return null
    const record = row as Record<string, unknown>

    const id = record[column.id]
    const email = record[column.email]
    const hash = record[column.passwordHash]

    if (typeof id !== 'string' && typeof id !== 'number') return null
    if (typeof email !== 'string') return null
    if (typeof hash !== 'string' || hash === '') return null

    const name = record[column.name]
    const disabled = record[column.disabled]

    return {
      id: String(id),
      email,
      passwordHash: hash,
      ...(typeof name === 'string' && name !== '' ? { name } : {}),
      ...(typeof disabled === 'boolean' ? { disabled } : {}),
    }
  }

  return {
    describes: model,

    async findByEmail(email) {
      /*
       * `findFirst`, not `findUnique`.
       *
       * The email column is very likely unique, and this store cannot know
       * that - a consumer mapping it onto an existing table may have it
       * indexed and not constrained. `findUnique` throws on a column Prisma
       * does not consider unique, which would turn a schema difference into a
       * 500 on the login route.
       */
      const rows = await delegate().findMany({
        where: { [column.email]: email },
        take: 1,
      })
      return toAccount(rows[0])
    },

    async findById(id) {
      const rows = await delegate().findMany({ where: { [column.id]: id }, take: 1 })
      return toAccount(rows[0])
    },

    async count() {
      return delegate().count()
    },

    async recordLogin(id) {
      // Best effort. A store mapped onto a table without this column should
      // not turn a successful sign-in into a failure, and the caller already
      // treats a rejection here as something to log rather than to surface.
      await delegate().update({
        where: { [column.id]: id },
        data: { [column.lastLoginAt]: new Date() },
      })
    },
  }
}
