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
  /** Application code refused the input. Its message reaches the client. */
  | 'validation'
  /** The database refused the write: unique, foreign key, or required. */
  | 'constraint'
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
 * The input is not acceptable, and the caller should be told why.
 *
 * Raised by application code - a hook rejecting a value, a rule the schema
 * cannot express - rather than by the framework. It exists because such a
 * refusal has to reach the person who typed the value, and the alternatives are
 * wrong in one direction or the other: `InvalidQueryError` claims the *query*
 * was malformed, and anything unrecognised becomes a generic 500 with the
 * message withheld.
 *
 * The message **is** forwarded to the client, which is the point of it and also
 * the responsibility that comes with it: whatever goes in is published.
 *
 * Naming the fields it is about is optional and worth doing. An interface that
 * knows which input was refused can say so next to that input, where the person
 * is looking, instead of in a banner above a form they then have to re-read.
 */
export class ValidationError extends NestAdminError {
  override readonly kind = 'validation' as const

  constructor(
    message: string,
    /** The inputs this is about. Empty when it is about the record as a whole. */
    readonly fields: readonly string[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

/**
 * What the database refused, and about which fields.
 *
 * The distinction that matters is between a request that is *wrong* and a
 * database that is *broken*. A duplicate email, a foreign key pointing at
 * nothing, a missing required value - these are ordinary mistakes a person
 * makes in a form, and until they were told apart from a real failure the admin
 * answered every one of them with "an internal error occurred".
 *
 * The message is built here, from the constraint and the field names, rather
 * than taken from the ORM. An ORM's own text carries file paths, generated
 * query fragments and the values that collided, none of which should be
 * published - which is exactly why the generic 500 existed in the first place.
 */
export type ConstraintKind =
  /** A value that has to be unique is not. */
  | 'unique'
  /** A reference points at a record that is not there, or is still referenced. */
  | 'foreign-key'
  /** A value the database requires was not supplied. */
  | 'required'

export class ConstraintError extends NestAdminError {
  override readonly kind = 'constraint' as const

  constructor(
    readonly constraint: ConstraintKind,
    readonly model: string,
    /** The columns involved. Empty when the ORM did not say. */
    readonly fields: readonly string[] = [],
  ) {
    super(describeConstraint(constraint, model, fields))
  }
}

/**
 * A sentence for the person who filled in the form.
 *
 * Written from the field names alone, so it is safe to forward. Where the ORM
 * did not name a field the wording stays true rather than guessing at one.
 */
function describeConstraint(
  constraint: ConstraintKind,
  model: string,
  fields: readonly string[],
): string {
  const named = fields.length > 0 ? fields.join(', ') : undefined

  switch (constraint) {
    case 'unique':
      return named
        ? `Another ${model} already has this ${named}.`
        : `Another ${model} already has one of these values.`

    case 'foreign-key':
      return named
        ? `The ${named} does not refer to an existing record, or the record it refers to is still in use.`
        : `A reference on this ${model} does not point at an existing record, or is still in use.`

    case 'required':
      return named ? `${named} is required.` : `A required value on this ${model} is missing.`
  }
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
