import { Module } from '@nestjs/common'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import {
  AdminModule,
  ForbiddenError,
  UnauthorizedError,
  type AdminAuth,
} from '@nest-admin/nest-admin'
import { PrismaAdapter } from '@nest-admin/nest-admin/prisma'

import { PrismaClient } from './generated/prisma/client.js'

/**
 * The reference consumer.
 *
 * Everything here is what a real application writes. Nothing is imported from
 * `@nest-admin/core` or `@nest-admin/prisma` directly - only the single public
 * package and its `./prisma` subpath, exactly as an installed consumer would.
 */

/**
 * The application owns its database client.
 *
 * Prisma 7 builds a client from a driver adapter, so only the application knows
 * the provider and the connection. Nest Admin receives what is built here and
 * never constructs one.
 */
const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env['DATABASE_URL'] ?? 'file:./dev.db',
  }),
})

/**
 * The application owns identity.
 *
 * A deliberately crude stand-in for whatever the host already has - a session,
 * a JWT verified by middleware, a gateway header. The framework never inspects
 * a credential itself; it only asks this question.
 *
 * Set `ADMIN_TOKEN` to require the header; leave it unset and the admin is open,
 * which is fine for a local example and nothing else.
 */
const adminAuth: AdminAuth = {
  authorize(context) {
    const expected = process.env['ADMIN_TOKEN']
    if (!expected) return

    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>()
    const presented = request.headers['x-admin-token']

    if (typeof presented !== 'string' || presented === '') throw new UnauthorizedError()
    if (presented !== expected) throw new ForbiddenError()
  },
}

@Module({
  imports: [
    AdminModule.forRoot({
      adapter: new PrismaAdapter({ client: prisma }),
      auth: adminAuth,
      // Optional. Shown because per-model rules are the common next step:
      // Product is read-only here, User is fully editable.
      resourceAuth: {
        authorize({ model, operation }) {
          if (model === 'Product') return operation === 'metadata' || operation === 'list'
          return true
        },
      },
    }),
  ],
})
export class AppModule {}
