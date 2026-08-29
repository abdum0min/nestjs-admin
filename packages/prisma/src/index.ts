/**
 * `@nest-admin/prisma` - the Prisma adapter.
 *
 * Nothing is implemented yet. When it is, this package will contain the single
 * implementation of `OrmAdapter` from `@nest-admin/core`:
 *
 *   - reading model metadata from the generated Prisma Client's DMMF
 *   - translating Prisma models into `ModelMetadata`
 *   - resolving a model name to a Prisma Client delegate
 *   - translating `ListQuery` into Prisma `findMany` arguments
 *   - executing CRUD through the client
 *
 * The Prisma Client instance is always supplied by the consuming application;
 * this package must never construct one and never import a generated client
 * path of its own.
 */

export {}
