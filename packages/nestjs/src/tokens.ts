/**
 * Injection tokens.
 *
 * Symbols rather than strings so they cannot collide with a token in the host
 * application, and cannot be injected by accident.
 *
 * All of them are `Symbol.for`, from the global registry, and that is
 * load-bearing rather than stylistic. The package ships several entrypoints,
 * and the CJS build has no code splitting: each one inlines its own copy of
 * every internal module, this file included. A plain `Symbol('X')` would
 * therefore be a *different* symbol in `index.cjs` and in `dev-tools.cjs`, so a
 * provider registered under one would be invisible to a controller asking for
 * the other - dependency injection failing at start-up, in CJS only, with a
 * message naming a token that looks identical to the one that was registered.
 *
 * The registry key is namespaced for the collision property the symbols were
 * chosen for in the first place.
 */

/** The `OrmAdapter` the consuming application supplied to `AdminModule`. */
export const ADMIN_ADAPTER = Symbol.for('nest-admin.adapter')

/** The `AdminAuth` the consuming application supplied to `AdminModule`. */
export const ADMIN_AUTH = Symbol.for('nest-admin.auth')

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
/**
 * File storage and the size ceiling, or `undefined` when this admin has
 * neither - in which case the file routes answer as though they do not exist.
 */
export const ADMIN_FILES = Symbol.for('nest-admin.files')

export const ADMIN_CONCURRENCY = Symbol.for('nest-admin.concurrency')

export const ADMIN_TEAM = Symbol.for('nest-admin.team')

export const ADMIN_CAPABILITIES = Symbol.for('nest-admin.capabilities')

export const ADMIN_RESOURCE_AUTH = Symbol.for('nest-admin.resource-auth')

/**
 * Directory holding the built admin UI.
 *
 * Internal, and not part of the public API. It exists so the package can be
 * tested from source against the real built artefact, which lives in `dist`
 * while the tests run from `src`.
 */
export const ADMIN_UI_ROOT = Symbol.for('nest-admin.ui-root')

/**
 * The normalised path the admin is mounted under, e.g. `/admin`.
 *
 * The router already knows it, but the UI controller needs it too: the served
 * HTML carries absolute asset URLs and hands the base to the browser.
 */
export const ADMIN_MOUNT_PATH = Symbol.for('nest-admin.mount-path')

/**
 * The `ResourceSelection` the application supplied, if any.
 *
 * Structural rather than per-principal: it decides which models the admin has
 * at all. Always provided, so injection resolves either way.
 */
export const ADMIN_RESOURCES = Symbol.for('nest-admin.resources')

/**
 * The options object `forRootAsync` resolved.
 *
 * Internal. Every other option provider derives from it, so the factory runs
 * once no matter how many of its values are injected.
 */
export const ADMIN_OPTIONS = Symbol.for('nest-admin.options')

/**
 * Per-model configuration the application supplied, if any.
 *
 * Labels, widgets, ordering, and the two that are enforced rather than
 * suggested: `hidden` and `readOnly`.
 */
export const ADMIN_MODELS = Symbol.for('nest-admin.models')

/**
 * How the resources are grouped in the sidebar.
 *
 * A factory option rather than a structural one: it names models, and which
 * models exist is something the adapter answers after the module is defined.
 */
export const ADMIN_NAVIGATION = Symbol.for('nest-admin.navigation')

/** Application code that runs around a write. */
export const ADMIN_HOOKS = Symbol.for('nest-admin.hooks')

/** Application-defined actions, per model. */
export const ADMIN_ACTIONS = Symbol.for('nest-admin.actions')

/**
 * The widgets an application put on the dashboard.
 *
 * Absent means a dashboard built from the schema alone, which is the common
 * case and the one that has to look right without anybody configuring it.
 */
export const ADMIN_DASHBOARD = Symbol.for('nest-admin.dashboard')

/** Branding the served page applies without a rebuild. */
export const ADMIN_THEME = Symbol.for('nest-admin.theme')

/**
 * What the developer tools were configured with, when they are mounted.
 *
 * Provided as `undefined` when they are not, so the routes - which only exist
 * in that case anyway - have something to inject either way.
 */
export const ADMIN_DEV_TOOLS = Symbol.for('nest-admin.dev-tools')

/**
 * `AdminService`, addressed by token rather than by class.
 *
 * Nest keys dependency injection on class identity, and this package ships
 * several entrypoints whose CJS builds each inline their own copy of every
 * internal module. A controller in `dev-tools.cjs` asking for `AdminService`
 * therefore asks for a *different class object* than the one `index.cjs`
 * registered, and Nest reports a dependency it cannot resolve while pointing at
 * a class with the right name - which is as confusing as it sounds. Found by
 * starting the example application, not by reading the code.
 *
 * A symbol from the global registry is the same value in every copy.
 */
export const ADMIN_SERVICE = Symbol.for('nest-admin.service')
