/**
 * `@nest-admin/drizzle` - the Drizzle implementation of Core's `OrmAdapter`.
 *
 * Internal to the workspace, like `@nest-admin/prisma`: consumers reach it
 * through `@nest-admin/nestjs/drizzle`, which is the single published package's
 * second adapter subpath.
 */
export { DrizzleAdapter, type DrizzleAdapterOptions } from './adapter.js'
export { DEFAULT_PER_PAGE, MAX_PER_PAGE } from './query/build.js'
