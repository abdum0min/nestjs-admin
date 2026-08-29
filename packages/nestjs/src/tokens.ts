/**
 * Injection tokens.
 *
 * Symbols rather than strings so they cannot collide with a token in the host
 * application, and cannot be injected by accident.
 */

/** The `OrmAdapter` the consuming application supplied to `AdminModule`. */
export const ADMIN_ADAPTER = Symbol('NEST_ADMIN_ADAPTER')

/** The `AdminAuth` the consuming application supplied to `AdminModule`. */
export const ADMIN_AUTH = Symbol('NEST_ADMIN_AUTH')

/** The optional `AdminResourceAuth` the application supplied to `AdminModule`. */
export const ADMIN_RESOURCE_AUTH = Symbol('NEST_ADMIN_RESOURCE_AUTH')
