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

/**
 * Directory holding the built admin UI.
 *
 * Internal, and not part of the public API. It exists so the package can be
 * tested from source against the real built artefact, which lives in `dist`
 * while the tests run from `src`.
 */
export const ADMIN_UI_ROOT = Symbol('NEST_ADMIN_UI_ROOT')
