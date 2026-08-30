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

/**
 * The normalised path the admin is mounted under, e.g. `/admin`.
 *
 * The router already knows it, but the UI controller needs it too: the served
 * HTML carries absolute asset URLs and hands the base to the browser.
 */
export const ADMIN_MOUNT_PATH = Symbol('NEST_ADMIN_MOUNT_PATH')

/**
 * The `ResourceSelection` the application supplied, if any.
 *
 * Structural rather than per-principal: it decides which models the admin has
 * at all. Always provided, so injection resolves either way.
 */
export const ADMIN_RESOURCES = Symbol('NEST_ADMIN_RESOURCES')

/**
 * The options object `forRootAsync` resolved.
 *
 * Internal. Every other option provider derives from it, so the factory runs
 * once no matter how many of its values are injected.
 */
export const ADMIN_OPTIONS = Symbol('NEST_ADMIN_OPTIONS')
