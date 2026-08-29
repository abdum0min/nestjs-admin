import { Module } from '@nestjs/common'

/**
 * The reference consuming application.
 *
 * Nest Admin is installed but not wired in, because `AdminModule` does not
 * exist yet. Once the MVP lands, `nest-admin init` will print - and this file
 * will contain - something along these lines:
 *
 *   import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
 *   import { AdminModule } from '@nest-admin/nest-admin'
 *   import { PrismaAdapter } from '@nest-admin/nest-admin/prisma'
 *   import { PrismaClient } from './generated/prisma/client'
 *
 *   // Prisma 7 constructs a client from a driver adapter rather than from a
 *   // `url` in the schema.
 *   const prisma = new PrismaClient({
 *     adapter: new PrismaBetterSQLite3({ url: process.env.DATABASE_URL! }),
 *   })
 *
 *   @Module({
 *     imports: [
 *       AdminModule.forRoot({
 *         path: '/admin',
 *         adapter: new PrismaAdapter({ client: prisma }),
 *       }),
 *     ],
 *   })
 *
 * Nothing above is implemented. Do not treat it as a working API - the exact
 * option names are an open design question for the implementation phase.
 *
 * Note the two different meanings of "adapter" in play: Prisma's *driver*
 * adapter (database connectivity) and Nest Admin's *ORM* adapter (the
 * `OrmAdapter` contract). They are unrelated. Naming in the implementation
 * phase should avoid the collision.
 */
@Module({
  imports: [],
})
export class AppModule {}
