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
/**
 * Whether the current request may do something that is not about a model.
 *
 * A function rather than the role table, so nothing downstream has to know
 * whether roles were configured at all - without them it answers true, which is
 * what an admin with a single superuser has always meant.
 */
/**
 * The team service, when this admin has one.
 *
 * `undefined` when the login is not the built-in one, or its store cannot list
 * accounts - the routes then answer 404, because the feature is not part of
 * that deployment rather than forbidden within it.
 */
/**
 * Whether a write must carry the version it was based on.
 *
 * A string rather than a boolean so the option reads as a choice between two
 * strategies, which is what it is - and so a third could be added without
 * changing its shape.
 */
export const ADMIN_CONCURRENCY = Symbol.for('nest-admin.concurrency')

export const ADMIN_TEAM = Symbol.for('nest-admin.team')

export const ADMIN_CAPABILITIES = Symbol.for('nest-admin.capabilities')

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

/**
 * Per-model configuration the application supplied, if any.
 *
 * Labels, widgets, ordering, and the two that are enforced rather than
 * suggested: `hidden` and `readOnly`.
 */
export const ADMIN_MODELS = Symbol('NEST_ADMIN_MODELS')

/** Application code that runs around a write. */
export const ADMIN_HOOKS = Symbol('NEST_ADMIN_HOOKS')

/** Application-defined actions, per model. */
export const ADMIN_ACTIONS = Symbol('NEST_ADMIN_ACTIONS')

/**
 * The widgets an application put on the dashboard.
 *
 * Absent means a dashboard built from the schema alone, which is the common
 * case and the one that has to look right without anybody configuring it.
 */
export const ADMIN_DASHBOARD = Symbol('NEST_ADMIN_DASHBOARD')

/** Branding the served page applies without a rebuild. */
export const ADMIN_THEME = Symbol('NEST_ADMIN_THEME')
