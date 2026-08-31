/**
 * `@nest-admin/nestjs/drizzle` - the Drizzle adapter subpath.
 *
 * Beside `./prisma` and arranged the same way: an application that never
 * touches Drizzle never loads Drizzle code, and neither subpath knows the other
 * exists. This is the arrangement `./prisma` was built to allow, and this is
 * the first thing to actually use it.
 */

export * from '@nest-admin/drizzle'
