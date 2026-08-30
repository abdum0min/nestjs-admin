import { Module } from '@nestjs/common'
import { AdminModule, ForbiddenError, UnauthorizedError, type AdminAuth } from '@nest-admin/nestjs'
import { PrismaAdapter } from '@nest-admin/nestjs/prisma'

import { PrismaService } from './prisma.service.js'

/**
 * The reference consumer.
 *
 * Everything here is what a real application writes. Nothing is imported from
 * `@nest-admin/core` or `@nest-admin/prisma` directly - only the single public
 * package and its `./prisma` subpath, exactly as an installed consumer would.
 */

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

/**
 * Holds the database client, so the admin can be given one through injection.
 *
 * In a real application this module is usually already there, and usually has
 * more in it than one provider.
 */
@Module({ providers: [PrismaService], exports: [PrismaService] })
class DatabaseModule {}

@Module({
  imports: [
    // `forRootAsync` rather than `forRoot`, because the client is a provider
    // rather than a module-level value. That is the normal case: the client
    // usually needs configuration, and configuration usually arrives through
    // DI too. `forRoot` is there for the simpler arrangement.
    AdminModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [PrismaService],

      // Structural, so it stays out of the factory: routes are registered
      // before any provider exists. `/admin` is the default and is spelled out
      // here only to show where it goes.
      path: '/admin',

      useFactory: (prisma: PrismaService) => ({
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
    }),
  ],
})
export class AppModule {}
