/**
 * Application code that runs around a write.
 *
 * The admin is generic on purpose: it knows a schema, not a domain. Hashing a
 * password, deriving a slug, writing an audit row, sending a notification -
 * none of these can be inferred from a column type, and all of them are the
 * reason a real application eventually stops using a generic admin. This is the
 * seam where they go in.
 *
 * ## Where they run
 *
 * After authorization and after validation, immediately around the adapter
 * call. A hook is therefore never reached for a request that would have been
 * refused, and never sees a payload naming a hidden or read-only field.
 *
 * ## What a `before` hook returns
 *
 * The data to write. Returning a changed object is how a value is added or
 * rewritten, and returning the object unchanged is fine. It is not applied
 * blindly: the result is validated again, so a hook cannot introduce a field
 * the admin refuses to write.
 *
 * ## Failing
 *
 * Throw. A `ValidationError` reaches the caller with its message intact and is
 * the way to refuse an input for a reason a person should read. Anything else
 * becomes a 500 with the message withheld, which is the right treatment for a
 * hook that broke rather than one that objected.
 *
 * Nothing is transactional. An `after` hook that throws leaves the write
 * already done, so it should be used for work whose failure is not worse than
 * its absence - and anything that must be atomic belongs in the application's
 * own transaction, not here.
 */
import type { ExecutionContext } from '@nestjs/common'
import type { RecordData, RecordId } from '@nest-admin/core'

/** What every hook is given. */
export interface AdminHookContext {
  /**
   * The NestJS execution context for the request being served.
   *
   * Reach the principal through it, exactly as in `AdminAuth.authorize` and
   * `AdminResourceAuth.authorize` - one accessor works for all three.
   */
  readonly context: ExecutionContext

  /** The model being written. */
  readonly model: string
}

export interface AdminHooks {
  /** Runs before a record is created. Returns the data to write. */
  readonly beforeCreate?: (
    args: AdminHookContext & { readonly data: RecordData },
  ) => RecordData | Promise<RecordData>

  /** Runs after a record is created. Its return value is ignored. */
  readonly afterCreate?: (
    args: AdminHookContext & { readonly record: RecordData },
  ) => void | Promise<void>

  /**
   * Runs before a record is updated. Returns the data to write.
   *
   * The data is the *patch*, not the whole record: only the fields the request
   * named are present.
   */
  readonly beforeUpdate?: (
    args: AdminHookContext & { readonly id: RecordId; readonly data: RecordData },
  ) => RecordData | Promise<RecordData>

  readonly afterUpdate?: (
    args: AdminHookContext & { readonly id: RecordId; readonly record: RecordData },
  ) => void | Promise<void>

  /**
   * Runs before a record is deleted.
   *
   * Throw to refuse the deletion - a `ValidationError` says why in a way the
   * caller can read.
   */
  readonly beforeDelete?: (
    args: AdminHookContext & { readonly id: RecordId },
  ) => void | Promise<void>

  /** Runs after a record is deleted. The record is already gone. */
  readonly afterDelete?: (
    args: AdminHookContext & { readonly id: RecordId },
  ) => void | Promise<void>
}

/** Hooks per model. Models without an entry have none. */
export type AdminHooksByModel = Readonly<Record<string, AdminHooks>>
