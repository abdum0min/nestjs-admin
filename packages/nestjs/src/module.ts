/**
 * `AdminModule` - the NestJS integration.
 *
 * ```ts
 * AdminModule.forRoot({ adapter: new PrismaAdapter({ client: prisma }) })
 * ```
 *
 * The module wires an `OrmAdapter` into the admin HTTP layer and does nothing
 * else. It does not construct a database client, does not read configuration
 * from disk, and holds no module-level mutable state, so two instances in the
 * same process cannot interfere with each other.
 *
 * It is not `@Global()`: making a library's providers globally visible in
 * someone else's application is a decision the application should make.
 */
import type { OrmAdapter } from '@nest-admin/core'
import { Module, type DynamicModule } from '@nestjs/common'

import { AdminController } from './admin/controller.js'
import { AdminService } from './admin/service.js'
import { AdminExceptionFilter } from './http/exception.filter.js'
import { ADMIN_ADAPTER } from './tokens.js'

export interface AdminModuleOptions {
  /**
   * The ORM adapter the admin reads and writes through.
   *
   * Constructed by the consuming application, never by the framework: under
   * Prisma 7 a client is built from a driver adapter, so only the application
   * knows the provider, the credentials and the connection strategy.
   */
  readonly adapter: OrmAdapter
}

@Module({})
export class AdminModule {
  static forRoot(options: AdminModuleOptions): DynamicModule {
    if (!options?.adapter) {
      throw new Error(
        'AdminModule.forRoot() requires an `adapter`. ' +
          'Construct one in your application, for example ' +
          '`new PrismaAdapter({ client: prisma })`.',
      )
    }

    return {
      module: AdminModule,
      controllers: [AdminController],
      providers: [
        { provide: ADMIN_ADAPTER, useValue: options.adapter },
        AdminService,
        // Provided so Nest can resolve it for `@UseFilters` on the controller.
        // Deliberately not an APP_FILTER: that would replace error handling for
        // the whole host application, not just the admin routes.
        AdminExceptionFilter,
      ],
      exports: [AdminService],
    }
  }
}
