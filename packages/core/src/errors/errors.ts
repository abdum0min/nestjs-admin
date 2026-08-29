/**
 * Framework error vocabulary.
 *
 * Deliberately small. These exist so that adapters raise ORM-independent
 * errors and the future HTTP layer can map them to status codes without
 * knowing which ORM produced them. Resist growing this taxonomy - add a new
 * type only when a caller genuinely needs to branch on it.
 *
 * @experimental Draft contract. Expected to change during MVP implementation.
 */

/**
 * Base error type. Every error raised by Nest Admin extends it so that the
 * NestJS integration can distinguish framework errors from application errors
 * without depending on concrete subclasses.
 */
export class NestAdminError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
  }
}

/** The requested model is not part of the admin's resource set. */
export class ModelNotFoundError extends NestAdminError {
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
export class InvalidQueryError extends NestAdminError {}

/**
 * The underlying ORM or database failed. Always wraps the original error as
 * `cause` so the real failure is never lost.
 */
export class AdapterError extends NestAdminError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
  }
}
