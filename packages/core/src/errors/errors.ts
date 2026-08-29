/**
 * Base error type. Every error raised by Nest Admin extends it so that the
 * NestJS integration can distinguish framework errors from application errors
 * without depending on concrete subclasses.
 *
 * @experimental Draft contract. Expected to change during MVP implementation.
 */
export class NestAdminError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
  }
}
