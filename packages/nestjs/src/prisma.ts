/**
 * `@nest-admin/nest-admin/prisma` - the Prisma adapter subpath.
 *
 * Keeping the adapter behind a subpath rather than the root entrypoint means
 * an application that never touches Prisma never loads Prisma code, and a
 * future `@nest-admin/nest-admin/typeorm` slots in beside it without changing
 * the root export.
 *
 * The adapter itself is not implemented yet.
 */

export * from '@nest-admin/prisma'
