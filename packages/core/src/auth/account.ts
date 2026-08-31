/**
 * Where admin accounts live, as a contract.
 *
 * ## Why this exists at all
 *
 * Until 0.9.0 the answer to "who may open the admin?" was always the host
 * application's: it already had sessions, and `AdminAuth` asked it one
 * question. That is still right for a team that has an identity system, and
 * nothing about it changes.
 *
 * It is a wall for everyone else. An application with no login of its own had
 * to write a password hash, a session cookie and a form before the admin could
 * go anywhere near production - which is a strange thing to ask of a package
 * whose whole claim is that you do not build an admin.
 *
 * ## Why it is a contract rather than a table
 *
 * The same reason `OrmAdapter` is. An admin whose accounts can only live in
 * Prisma has learned about Prisma, and the second ORM would find out the hard
 * way. Everything here is plain data and promises; nothing knows what a
 * database is.
 *
 * ## These accounts are not the application's users
 *
 * Deliberately, and this is the point most worth getting right. The people who
 * administer a system are usually not rows in the table they administer, and
 * conflating the two means a customer record with a password that opens the
 * admin. The store is separate storage - a different model, or a different
 * database entirely - and the admin never reads or writes the application's
 * own users to decide who may sign in.
 */

/** One account that may sign in to the admin. */
export interface AdminAccount {
  readonly id: string

  /**
   * What is typed into the login form.
   *
   * Called `email` because that is what it almost always is, and a name people
   * recognise is worth more than one that covers a case nobody has. A store is
   * free to hold usernames in it.
   */
  readonly email: string

  /** Shown in the interface. Falls back to the email when absent. */
  readonly name?: string | undefined

  /**
   * The stored password hash, in whatever form the hasher produced.
   *
   * Read by the sign-in check and by nothing else. It must never reach a
   * response, and the account the interface is told about is a projection that
   * does not include it.
   */
  readonly passwordHash: string

  /**
   * Suspended without being deleted.
   *
   * Distinct from removing the row: an account that has done things is worth
   * keeping for the record, and "cannot sign in" is not the same fact as
   * "never existed".
   */
  readonly disabled?: boolean | undefined
}

/**
 * The account as the interface may see it.
 *
 * A separate type rather than a comment on {@link AdminAccount}, because "do
 * not send the hash" is a rule that gets forgotten and a type that cannot
 * carry it does not.
 */
export interface AdminAccountSummary {
  readonly id: string
  readonly email: string
  readonly name?: string | undefined
}

/** Everything but the hash. The only shape that may reach a client. */
export function summarise(account: AdminAccount): AdminAccountSummary {
  return {
    id: account.id,
    email: account.email,
    ...(account.name !== undefined ? { name: account.name } : {}),
  }
}

/**
 * How the admin reaches its accounts.
 *
 * Read-only by design. Creating and editing accounts is the application's
 * business: it owns the storage, it knows whether that is a migration, a seed
 * script or a form somewhere else, and an admin that could mint its own
 * administrators is an escalation waiting for its first mistake.
 */
export interface AdminAccountStore {
  /**
   * Find an account by what was typed into the login form.
   *
   * Matching is the store's decision, and it should be case-insensitive on the
   * local part in practice: someone who registered as `Ada@example.com` will
   * type `ada@example.com` eventually.
   *
   * Returns `null` when there is none. The caller must not behave observably
   * differently for `null` than for a wrong password - see the sign-in code.
   */
  findByEmail(email: string): Promise<AdminAccount | null>

  /**
   * Find an account by its id, for a request that arrives with a session.
   *
   * Called on every authenticated request, so it should be cheap. It is also
   * what makes a disabled or deleted account stop working immediately rather
   * than when its session happens to expire.
   */
  findById(id: string): Promise<AdminAccount | null>

  /**
   * How many accounts exist.
   *
   * Used once, at startup, to say so when the answer is zero - an admin nobody
   * can sign in to is a configuration mistake that otherwise announces itself
   * as a login form that rejects everything.
   */
  count(): Promise<number>

  /**
   * Note that an account signed in. Optional.
   *
   * A store that does not care about this can leave it out; the sign-in path
   * does not wait for it and a failure is logged rather than surfaced, because
   * "your login worked but we could not write down that it did" is not
   * something the person signing in can act on.
   */
  recordLogin?(id: string): Promise<void>

  /**
   * What this store reads, for diagnostics. Optional.
   *
   * A model name, a table, a directory - whatever names the storage in a way a
   * person would recognise. It exists so a startup check can say something
   * useful rather than something generic: an admin that exposes its own
   * account model as an editable resource is an escalation, and a warning that
   * cannot name the model is a warning nobody acts on.
   *
   * Never used to decide anything, and never sent to a client.
   */
  readonly describes?: string
}
