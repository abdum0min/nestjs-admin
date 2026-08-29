/**
 * `@nest-admin/prisma` - the Prisma adapter.
 *
 * The public surface is deliberately small: an adapter, its options, and the
 * two schema errors a consumer can actually act on. The metadata reader, the
 * DMMF mapper, the query translator and the delegate resolver are internal -
 * exporting them would freeze implementation details that are expected to
 * change when metadata acquisition moves to a build-time Prisma generator.
 */

export { PrismaAdapter, type PrismaAdapterOptions } from './adapter.js'

export { PrismaSchemaInvalidError, PrismaSchemaNotFoundError } from './metadata/read-dmmf.js'

export { PrismaVersionUnsupportedError } from './client/version-gate.js'
