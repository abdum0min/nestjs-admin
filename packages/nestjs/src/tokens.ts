/**
 * Injection tokens.
 *
 * A `Symbol` rather than a string so it cannot collide with a token in the
 * host application, and so it cannot be injected by accident.
 */

/** The `OrmAdapter` the consuming application supplied to `AdminModule`. */
export const ADMIN_ADAPTER = Symbol('NEST_ADMIN_ADAPTER')
