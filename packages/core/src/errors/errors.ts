/**
 * Framework error vocabulary.
 *
 * Deliberately small. These exist so that adapters raise ORM-independent
 * errors and the transport layer can map them to status codes without knowing
 * which ORM produced them. Resist growing this taxonomy - add a new type only
 * when a caller genuinely needs to branch on it.
 *
 * ## Why these are not identified with `instanceof`
 *
 * A published bundle can contain more than one copy of this module. The
 * package ships two CommonJS entrypoints and each inlines its own copy of
 * Core, so an error thrown inside the Prisma adapter is an instance of a
 * *different* `FieldNotFoundError` class than the one the exception filter
 * holds. `instanceof` compares class identity, so it answered `false` and
 * every adapter-raised error was mapped to a generic 500 - a caller who
 * mistyped a sort field got "internal error" instead of "unknown field".
 *
 * That was invisible to this repository's own tests, which resolve Core to a
 * single source module, and only appeared when the built package was installed
 * and run. So errors are identified by *value* rather than identity: a
 * `Symbol.for` brand, which duplicate copies agree on by definition, plus a
 * stable `kind` string. Neither depends on which copy created the object.
 *
 * See reports/009-consumer-acceptance.md.
 *
 * @experimental Draft contract. Expected to change during MVP implementation.
 */

/**
 * Cross-copy brand.
 *
 * `Symbol.for` resolves through the global symbol registry, so two copies of
 * this file agree on the key where two `Symbol()` calls would not.
 */
const BRAND = Symbol.for('nest-admin.error')

/**
 * Stable discriminator for each error type.
 *
 * A declared string rather than the class, so it survives duplicate bundles,
 * and rather than `name`, so it survives minification.
 */
export type AdminErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'model-not-found'
  | 'field-not-found'
  | 'record-not-found'
  | 'invalid-query'
  | 'adapter'
  /** A subclass that declared no kind of its own. Treated as internal. */
  | 'unknown'

/**
 * Base error type. Every error raised by Nest Admin extends it so that the
 * NestJS integration can distinguish framework errors from application errors
 * without depending on concrete subclasses.
 */
export class NestAdminError extends Error {
  /**
   * Which error this is.
   *
   * Subclasses override it with a literal. The base value covers anything that
   * extends this class without declaring one - the Prisma schema errors, for
   * instance - which the transport layer treats as internal.
   */
  readonly kind: AdminErrorKind = 'unknown'

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
    // Non-enumerable, so it can never reach a serialised response body.
    Object.defineProperty(this, BRAND, { value: true, enumerable: false })
  }
}

/**
 * Is this one of ours?
 *
 * Works across duplicate copies of this module, which `instanceof` does not.
 */
export function isNestAdminError(value: unknown): value is NestAdminError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[BRAND] === true
  )
}

/** The requested model is not part of the admin's resource set. */
export class ModelNotFoundError extends NestAdminError {
  override readonly kind = 'model-not-found' as const

  constructor(
    readonly model: string,
    readonly availableModels: readonly string[] = [],
  ) {
    const known = availableModels.length > 0 ? ` Known models: ${availableModels.join(', ')}.` : ''
    super(`Unknown model "${model}".${known}`)
  }
}

/** A referenced field does not exist on the model, or cannot be used this way. */
export class FieldNotFoundError extends NestAdminError {
  override readonly kind = 'field-not-found' as const

  constructor(
    readonly model: string,
    readonly field: string,
    reason?: string,
  ) {
    super(`Unknown field "${field}" on model "${model}".${reason ? ` ${reason}` : ''}`)
  }
}

/** No record matched the given identifier. */
export class RecordNotFoundError extends NestAdminError {
  override readonly kind = 'record-not-found' as const

  constructor(
    readonly model: string,
    readonly id: unknown,
  ) {
    super(`No ${model} record found for id ${JSON.stringify(id)}.`)
  }
}

/**
 * The query is structurally invalid - an unusable operator/field combination,
 * a malformed value, or a request the adapter cannot express.
 */
export class InvalidQueryError extends NestAdminError {
  override readonly kind = 'invalid-query' as const
}

/**
 * The underlying ORM or database failed. Always wraps the original error as
 * `cause` so the real failure is never lost.
 */
export class AdapterError extends NestAdminError {
  override readonly kind = 'adapter' as const

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
  }
}

/**
 * No authenticated identity was presented with the request.
 *
 * Raised by the host application's admin auth implementation, never by Core
 * itself - Core has no notion of a request, a header or a session, and must
 * not acquire one. It exists here so the transport layer can map it without
 * knowing which framework produced it.
 *
 * The default message is deliberately uninformative. An authentication failure
 * must not reveal whether a credential was absent, malformed, expired or
 * simply wrong.
 */
export class UnauthorizedError extends NestAdminError {
  override readonly kind = 'unauthorized' as const

  constructor(message = 'Authentication is required to access the admin API.') {
    super(message)
  }
}

/**
 * An identity was established, but it is not permitted to do this.
 *
 * Deliberately distinct from {@link UnauthorizedError}: collapsing the two
 * leaves a client unable to tell "log in" from "you cannot do this", and
 * pushes that guesswork into every consumer.
 */
export class ForbiddenError extends NestAdminError {
  override readonly kind = 'forbidden' as const

  constructor(message = 'You do not have permission to access the admin API.') {
    super(message)
  }
}
