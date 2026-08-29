/**
 * `AdminModule` - the NestJS integration.
 *
 * ```ts
 * AdminModule.forRoot({
 *   adapter: new PrismaAdapter({ client: prisma }),
 *   auth: myAdminAuth,
 * })
 * ```
 *
 * The module wires an `OrmAdapter` and an `AdminAuth` into the admin HTTP
 * layer and does nothing else. It does not construct a database client, does
 * not authenticate anyone, does not read configuration from disk, and holds no
 * module-level mutable state - so two instances in the same process cannot
 * interfere with each other.
 *
 * It is not `@Global()`: making a library's providers globally visible in
 * someone else's application is a decision the application should make.
 */
import type { OrmAdapter } from '@nest-admin/core'
import { Module, type DynamicModule } from '@nestjs/common'

import { AdminController } from './admin/controller.js'
import { AdminService } from './admin/service.js'
import { warnIfUnsafe, type AdminAuth } from './auth/contract.js'
import { AdminAuthGuard } from './auth/guard.js'
import { allowAllResources, type AdminResourceAuth } from './auth/resource.js'
import { AdminExceptionFilter } from './http/exception.filter.js'
import { ADMIN_ADAPTER, ADMIN_AUTH, ADMIN_RESOURCE_AUTH } from './tokens.js'

export interface AdminModuleOptions {
  /**
   * The ORM adapter the admin reads and writes through.
   *
   * Constructed by the consuming application, never by the framework: under
   * Prisma 7 a client is built from a driver adapter, so only the application
   * knows the provider, the credentials and the connection strategy.
   */
  readonly adapter: OrmAdapter

  /**
   * Decides whether a request may reach the admin.
   *
   * **Required, deliberately.** The admin exposes every record in the database
   * and, through `/admin/meta`, the shape of the entire schema. An optional
   * option defaulting to "open" would mean a forgotten line in a config file
   * silently publishes the database - the failure would be invisible until
   * someone else found it.
   *
   * For local development and examples, pass `unsafeAllowAllRequests()`, which
   * is explicit at the call site and warns at startup.
   */
  readonly auth: AdminAuth

  /**
   * Decides which models this principal may see and act on.
   *
   * Optional, defaulting to allowing every model. Unlike `auth`, that default
   * is not a hole: `auth` is required, so the door is already shut, and
   * omitting this only means everyone admitted sees the whole schema - exactly
   * the behaviour before the option existed. Requiring it would break every
   * existing consumer to express a rule most applications do not have.
   *
   * Supply it when some models should be invisible or read-only to some
   * principals. A model denied for `'metadata'` disappears from
   * `GET /admin/meta`; a model denied for any other operation makes the request
   * fail with 403 before the ORM adapter is called.
   */
  readonly resourceAuth?: AdminResourceAuth
}

@Module({})
export class AdminModule {
  static forRoot(options: AdminModuleOptions): DynamicModule {
    // Validated here, at module construction, rather than through DI. A missing
    // provider surfaces as an injection error on the first request, long after
    // the mistake and nowhere near it.
    if (!options?.adapter) {
      throw new Error(
        'AdminModule.forRoot() requires an `adapter`. ' +
          'Construct one in your application, for example ' +
          '`new PrismaAdapter({ client: prisma })`.',
      )
    }

    if (!options.auth || typeof options.auth.authorize !== 'function') {
      throw new Error(
        'AdminModule.forRoot() requires an `auth` implementation with an ' +
          '`authorize(context)` method. The admin API exposes every record and ' +
          'the whole schema, so it is never public by default. ' +
          'For local development only, pass `unsafeAllowAllRequests()`.',
      )
    }

    if (options.resourceAuth && typeof options.resourceAuth.authorize !== 'function') {
      throw new Error(
        'AdminModule.forRoot() was given a `resourceAuth` without an ' +
          '`authorize(resource)` method. Omit it to allow every model, or ' +
          'supply an implementation.',
      )
    }

    warnIfUnsafe(options.auth)

    return {
      module: AdminModule,
      controllers: [AdminController],
      providers: [
        { provide: ADMIN_ADAPTER, useValue: options.adapter },
        { provide: ADMIN_AUTH, useValue: options.auth },
        // Always provided, so injection resolves whether or not the consumer
        // supplied a policy. The default permits every model.
        { provide: ADMIN_RESOURCE_AUTH, useValue: options.resourceAuth ?? allowAllResources() },
        AdminService,
        // Provided so Nest can resolve them for `@UseGuards` / `@UseFilters` on
        // the controller. Deliberately not APP_GUARD or APP_FILTER: either
        // would take over behaviour for the whole host application rather than
        // just the admin routes.
        AdminAuthGuard,
        AdminExceptionFilter,
      ],
      exports: [AdminService],
    }
  }
}
