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
import type { ModelOverrides, OrmAdapter, ResourceSelection } from '@nest-admin/core'
import {
  Logger,
  Module,
  type DynamicModule,
  type FactoryProvider,
  type ModuleMetadata,
  type Provider,
  type Type,
} from '@nestjs/common'
import { RouterModule } from '@nestjs/core'

import { AdminController } from './admin/controller.js'
import { AdminAuthController } from './auth/controller.js'
import { AdminService } from './admin/service.js'
import { warnIfUnsafe, type AdminAuth } from './auth/contract.js'
import { AdminAuthGuard } from './auth/guard.js'
import { allowAllResources, type AdminResourceAuth } from './auth/resource.js'
import {
  capabilityChecker,
  combineResourceAuth,
  rolesToResourceAuth,
  type AdminRoles,
  type RoleResolver,
} from './auth/roles.js'
import type { AdminActionsByModel } from './actions/contract.js'
import type { AdminHooksByModel } from './hooks/contract.js'
import { AdminExceptionFilter } from './http/exception.filter.js'
import { normaliseMountPath } from './mount-path.js'
import { uiAvailable, uiRoot } from './ui/assets.js'
import type { AdminDashboard } from './dashboard/contract.js'
import { assertUsableTheme, type AdminTheme } from './ui/theme.js'
import { AdminUiController } from './ui/controller.js'
import {
  ADMIN_ACTIONS,
  ADMIN_DASHBOARD,
  ADMIN_ADAPTER,
  ADMIN_AUTH,
  ADMIN_HOOKS,
  ADMIN_MODELS,
  ADMIN_MOUNT_PATH,
  ADMIN_OPTIONS,
  ADMIN_CAPABILITIES,
  ADMIN_RESOURCE_AUTH,
  ADMIN_RESOURCES,
  ADMIN_THEME,
  ADMIN_UI_ROOT,
} from './tokens.js'

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

  /**
   * Named roles, as a shorthand for `resourceAuth`.
   *
   * Optional, and omitting it changes nothing: an admin without roles behaves
   * exactly as it did before they existed, with every administrator permitted
   * everything.
   *
   * Supplying both `roles` and `resourceAuth` is allowed and means **both**
   * must agree. Adding a rule can then only remove access, never grant it,
   * which is the direction a permission system should fail in.
   *
   * Requires `roleOf`, and says so at startup rather than silently denying
   * every request.
   */
  readonly roles?: AdminRoles

  /**
   * Which role is making this request. Required when `roles` is set.
   *
   * Reads from the same `ExecutionContext` that `auth` and `resourceAuth` read
   * from, so whatever attached the principal is reachable here too.
   */
  readonly roleOf?: RoleResolver

  /**
   * Where the admin is mounted. Defaults to `/admin`.
   *
   * Accepts `admin`, `/admin` and `/admin/` alike, and may be nested, as in
   * `/internal/admin`. It cannot be empty or `/`: these routes end in
   * `:model`, so mounting them at the root would capture every unmatched
   * request in the host application.
   *
   * The API and the UI move together. There is one mount point, not two.
   */
  readonly path?: string

  /**
   * Which models the admin exposes at all. Defaults to every model the adapter
   * reports.
   *
   * Structural, and not a substitute for `resourceAuth`: this is the same for
   * every principal, so an excluded model answers 404 rather than 403. Use it
   * for tables that are not domain data - session stores, migration
   * bookkeeping, queues - and `resourceAuth` for who may do what.
   *
   * A name that matches no model fails at startup rather than being ignored: a
   * typo in `exclude` would otherwise leave the model exposed.
   */
  readonly resources?: ResourceSelection

  /**
   * Per-model configuration: labels, widgets, ordering, and the two that are
   * enforced rather than suggested - hidden and readOnly.
   *
   * A hidden field is removed from the metadata every layer reads, so it cannot
   * be filtered, sorted, written, or returned. A name matching no model or
   * field fails at startup.
   */
  readonly models?: ModelOverrides

  /**
   * Application code that runs around a write, per model.
   *
   * Where hashing a password, deriving a slug or writing an audit row goes -
   * none of which can be inferred from a column type. See `AdminHooks`.
   */
  readonly hooks?: AdminHooksByModel

  /**
   * Buttons the application adds, per model.
   *
   * CRUD covers what a schema implies; "publish" and "resend the invitation"
   * are obvious to the domain and invisible to the database. See `AdminAction`.
   */
  readonly actions?: AdminActionsByModel

  /**
   * Branding the served page applies without a rebuild: an accent colour, a
   * title, a logo. Structural, because the page is rendered before any
   * provider exists.
   */
  readonly theme?: AdminTheme

  /**
   * What the dashboard shows.
   *
   * Omit it and the dashboard is built from the schema: a count per model, the
   * newest records, and a month of activity. Declaring widgets replaces that
   * rather than adding to it - a dashboard is a page someone designed, and
   * half-designed is worse than either.
   */
  readonly dashboard?: AdminDashboard

  /**
   * Directory holding the built admin UI.
   *
   * Defaults to the copy bundled inside this package, which is what a consumer
   * wants and why it is optional. Overriding it exists for this repository's
   * own tests, which run from `src` while the built UI lives in `dist`.
   *
   * @internal
   */
  readonly uiRoot?: string
}

/**
 * Reject options that cannot work, as early as the caller allows.
 *
 * For `forRoot` that is module construction; for `forRootAsync` it is whenever
 * the factory resolves, which is still during application start-up. Either way
 * it beats the alternative - an injection error on the first request, long
 * after the mistake and nowhere near it.
 *
 * `caller` names the method in the message so the reader is pointed at the call
 * they actually wrote.
 */
function assertUsableOptions(options: AdminModuleOptions, caller: string): void {
  if (!options?.adapter) {
    throw new Error(
      `AdminModule.${caller}() requires an \`adapter\`. ` +
        'Construct one in your application, for example ' +
        '`new PrismaAdapter({ client: prisma })`.',
    )
  }

  if (!options.auth || typeof options.auth.authorize !== 'function') {
    throw new Error(
      `AdminModule.${caller}() requires an \`auth\` implementation with an ` +
        '`authorize(context)` method. The admin API exposes every record and ' +
        'the whole schema, so it is never public by default. ' +
        'For local development only, pass `unsafeAllowAllRequests()`.',
    )
  }

  if (options.roles !== undefined && typeof options.roleOf !== 'function') {
    // Without a resolver every request has no role, and a role table with no
    // role denies everything - a locked-out admin with no explanation. Better
    // to refuse to start than to lock someone out of their own data.
    throw new Error(
      `AdminModule.${caller}() was given \`roles\` without \`roleOf\`. ` +
        'Add roleOf: (context) => … so the admin can tell which role is asking.',
    )
  }

  if (options.roleOf !== undefined && options.roles === undefined) {
    throw new Error(
      `AdminModule.${caller}() was given \`roleOf\` without \`roles\`. ` +
        'Add a roles table, or remove roleOf - on its own it decides nothing.',
    )
  }
  if (options.resourceAuth && typeof options.resourceAuth.authorize !== 'function') {
    throw new Error(
      `AdminModule.${caller}() was given a \`resourceAuth\` without an ` +
        '`authorize(resource)` method. Omit it to allow every model, or ' +
        'supply an implementation.',
    )
  }

  warnIfUnsafe(options.auth)
}

/**
 * What a `forRootAsync` factory returns.
 *
 * Everything except the structural options, which are decided when the module
 * is defined and so cannot come from a provider - see `forRootAsync`.
 */
export type AdminModuleFactoryOptions = Omit<AdminModuleOptions, 'path' | 'uiRoot' | 'theme'>

/** Supply options from a class rather than a factory function. */
export interface AdminModuleOptionsFactory {
  createAdminOptions(): AdminModuleFactoryOptions | Promise<AdminModuleFactoryOptions>
}

export interface AdminModuleAsyncOptions {
  /** As `AdminModuleOptions.path`. Structural, so it is not from the factory. */
  readonly path?: string

  /** @internal As `AdminModuleOptions.uiRoot`. */
  readonly uiRoot?: string

  /**
   * As `AdminModuleOptions.theme`. Structural, so it is not from the factory:
   * the shell is rendered from it and no provider exists at that point.
   */
  readonly theme?: AdminTheme

  /** Modules whose providers the factory needs. */
  readonly imports?: ModuleMetadata['imports']

  /** Providers passed to `useFactory`, in order. */
  readonly inject?: FactoryProvider['inject']

  readonly useFactory?: (
    ...args: never[]
  ) => AdminModuleFactoryOptions | Promise<AdminModuleFactoryOptions>

  /** Instantiated by Nest, then asked for the options. */
  readonly useClass?: Type<AdminModuleOptionsFactory>

  /** An options factory the application already provides elsewhere. */
  readonly useExisting?: Type<AdminModuleOptionsFactory>
}

/** Say once, at startup, that the API works but the interface is not there. */
/**
 * The policy the admin will actually enforce.
 *
 * Roles compile to a policy and are then indistinguishable from a hand-written
 * one, so there is a single enforcement path rather than two - which is what
 * stops a permission from being missed in one of them.
 */
function resolvePolicy(options: {
  readonly resourceAuth?: AdminResourceAuth
  readonly roles?: AdminRoles
  readonly roleOf?: RoleResolver
}): AdminResourceAuth {
  const fromRoles =
    options.roles !== undefined && options.roleOf !== undefined
      ? rolesToResourceAuth(options.roles, options.roleOf)
      : undefined

  if (fromRoles === undefined) return options.resourceAuth ?? allowAllResources()
  if (options.resourceAuth === undefined) return fromRoles

  return combineResourceAuth(fromRoles, options.resourceAuth)
}

function warnIfUiMissing(resolvedUiRoot: string, mountPath: string): void {
  if (uiAvailable(resolvedUiRoot)) return

  // Not fatal - the API is perfectly usable on its own, and a source checkout
  // that has not run the UI build lands here. Said once, at startup, rather
  // than as a 404 someone has to reverse-engineer.
  new Logger('NestAdmin').warn(
    `The admin UI was not found in this build; ${mountPath} will return 404. ` +
      `The API under ${mountPath} is unaffected.`,
  )
}

/**
 * The parts of the module that do not depend on how the options arrived.
 *
 * Both entry points produce the same routes, controllers and services; they
 * differ only in how the four option providers get their values, which is why
 * those are passed in.
 */
function defineModule(
  mountPath: string,
  resolvedUiRoot: string,
  theme: AdminTheme | undefined,
  optionProviders: readonly Provider[],
  extraImports: ModuleMetadata['imports'] = [],
): DynamicModule {
  return {
    module: AdminModule,
    imports: [
      ...extraImports,
      // The mount path is applied here, not on the controllers: `@Controller()`
      // is evaluated when the class is defined, long before either entry point
      // sees any options. `RouterModule` prefixes the module's routes and
      // preserves controller order, which the collision rule below depends on.
      RouterModule.register([{ path: mountPath, module: AdminModule }]),
    ],
    // Order matters and is the whole answer to the route collision. The UI
    // controller binds exactly two paths - the mount path itself and
    // `assets/:file` - and is matched first, so `assets` can never be read as a
    // model name. The auth controller claims `auth/*` next, for the same
    // reason and at the same cost: a model named `auth` is unreachable, as one
    // named `assets` or `actions` already was. Everything else falls through to
    // the API controller.
    controllers: [AdminUiController, AdminAuthController, AdminController],
    providers: [
      ...optionProviders,
      { provide: ADMIN_UI_ROOT, useValue: resolvedUiRoot },
      { provide: ADMIN_MOUNT_PATH, useValue: mountPath },
      { provide: ADMIN_THEME, useValue: theme },
      AdminService,
      // Provided so Nest can resolve them for `@UseGuards` / `@UseFilters` on
      // the controller. Deliberately not APP_GUARD or APP_FILTER: either would
      // take over behaviour for the whole host application rather than just the
      // admin routes.
      AdminAuthGuard,
      AdminExceptionFilter,
    ],
    exports: [AdminService],
  }
}

/**
 * Providers that produce the resolved options object for `forRootAsync`.
 *
 * Validation happens here rather than in each derived provider, so a bad
 * factory result is reported once, as the options resolve, and names the
 * method the reader called.
 */
/**
 * The options that cannot come from the factory.
 *
 * Routes are registered and the shell is rendered when the module is defined,
 * which is before any provider exists - so these three are read from the
 * `forRootAsync` call itself, beside `imports` and `inject`.
 */
const STRUCTURAL_OPTIONS = ['path', 'uiRoot', 'theme'] as const

/**
 * Refuse a structural option returned from the factory.
 *
 * `AdminModuleFactoryOptions` omits these three, so this looks like something
 * TypeScript already prevents. It does not: excess property checking applies
 * to an object literal assigned directly to a typed target, and a factory’s
 * return value reaches that target through a *function* type, where the check
 * does not run. The compiler accepts it and the option is silently dropped.
 *
 * Which is not hypothetical - this repository’s own reference consumer put
 * `theme` inside `useFactory`, typechecked clean, and served an unbranded
 * page. The only symptom was a colour that never arrived.
 */
function assertNoStructuralOptions(resolved: AdminModuleFactoryOptions): void {
  const misplaced = STRUCTURAL_OPTIONS.filter((key) => key in (resolved as object))
  if (misplaced.length === 0) return

  const one = misplaced.length === 1
  throw new Error(
    `AdminModule.forRootAsync() received ${misplaced.join(', ')} from its factory. ` +
      `${one ? 'That option is' : 'Those options are'} structural: routes are registered ` +
      `before any provider exists, so ${one ? 'it' : 'they'} must be passed to ` +
      `forRootAsync() itself, beside \`imports\` and \`inject\`, rather than returned ` +
      `from \`useFactory\`.`,
  )
}

function optionsProviders(options: AdminModuleAsyncOptions): Provider[] {
  const validate = (resolved: AdminModuleFactoryOptions): AdminModuleOptions => {
    assertNoStructuralOptions(resolved)
    assertUsableOptions(resolved as AdminModuleOptions, 'forRootAsync')
    return resolved as AdminModuleOptions
  }

  if (options.useFactory) {
    return [
      {
        provide: ADMIN_OPTIONS,
        useFactory: async (...args: never[]) => validate(await options.useFactory!(...args)),
        inject: options.inject ?? [],
      },
    ]
  }

  const factoryClass = options.useExisting ?? options.useClass
  return [
    // `useClass` has to be instantiated by Nest before it can be asked;
    // `useExisting` is already provided by the application.
    ...(options.useClass ? [{ provide: options.useClass, useClass: options.useClass }] : []),
    {
      provide: ADMIN_OPTIONS,
      useFactory: async (factory: AdminModuleOptionsFactory) =>
        validate(await factory.createAdminOptions()),
      inject: [factoryClass as Type<AdminModuleOptionsFactory>],
    },
  ]
}

@Module({})
export class AdminModule {
  static forRoot(options: AdminModuleOptions): DynamicModule {
    assertUsableOptions(options, 'forRoot')

    // Throws on an unusable value, so a bad path fails at startup rather than
    // as a 404 on a route nobody can find.
    const mountPath = normaliseMountPath(options.path)

    const resolvedUiRoot = options.uiRoot ?? uiRoot()
    warnIfUiMissing(resolvedUiRoot, mountPath)
    assertUsableTheme(options.theme)

    return defineModule(mountPath, resolvedUiRoot, options.theme, [
      { provide: ADMIN_ADAPTER, useValue: options.adapter },
      { provide: ADMIN_RESOURCES, useValue: options.resources },
      { provide: ADMIN_MODELS, useValue: options.models },
      { provide: ADMIN_HOOKS, useValue: options.hooks },
      { provide: ADMIN_ACTIONS, useValue: options.actions },
      { provide: ADMIN_DASHBOARD, useValue: options.dashboard },
      { provide: ADMIN_AUTH, useValue: options.auth },
      // Always provided, so injection resolves whether or not the consumer
      // supplied a policy. The default permits every model.
      { provide: ADMIN_RESOURCE_AUTH, useValue: resolvePolicy(options) },
      { provide: ADMIN_CAPABILITIES, useValue: capabilityChecker(options.roles, options.roleOf) },
    ])
  }

  /**
   * The same module, with the adapter and the auth policy resolved through DI.
   *
   * For the ordinary case where those things are not available when the module
   * is declared: a `PrismaService` that belongs to another module, a connection
   * string that comes from `ConfigService`.
   *
   * ```ts
   * AdminModule.forRootAsync({
   *   imports: [PrismaModule, ConfigModule],
   *   inject: [PrismaService, ConfigService],
   *   useFactory: (prisma: PrismaService, config: ConfigService) => ({
   *     adapter: new PrismaAdapter({ client: prisma }),
   *     auth: new SessionAdminAuth(config.get('ADMIN_ROLE')),
   *   }),
   * })
   * ```
   *
   * `path` stays on this object rather than coming from the factory. Routes are
   * registered when the module is defined, which is before any provider has
   * been instantiated, so the mount path cannot wait for an injection - and a
   * `path` returned from the factory would be silently ignored, which is worse
   * than not offering it.
   */
  static forRootAsync(options: AdminModuleAsyncOptions): DynamicModule {
    if (!options?.useFactory && !options?.useClass && !options?.useExisting) {
      throw new Error(
        'AdminModule.forRootAsync() requires one of `useFactory`, `useClass` ' +
          'or `useExisting`. To configure the admin directly, use forRoot().',
      )
    }

    const mountPath = normaliseMountPath(options.path)
    const resolvedUiRoot = options.uiRoot ?? uiRoot()
    warnIfUiMissing(resolvedUiRoot, mountPath)
    assertUsableTheme(options.theme)

    // Each option provider reads from the single resolved object, so the
    // factory runs once however many of its values are injected.
    const derive = (
      token: symbol,
      read: (resolved: AdminModuleOptions) => unknown,
    ): FactoryProvider => ({ provide: token, useFactory: read, inject: [ADMIN_OPTIONS] })

    return defineModule(
      mountPath,
      resolvedUiRoot,
      options.theme,
      [
        ...optionsProviders(options),
        derive(ADMIN_ADAPTER, (resolved) => resolved.adapter),
        derive(ADMIN_RESOURCES, (resolved) => resolved.resources),
        derive(ADMIN_MODELS, (resolved) => resolved.models),
        derive(ADMIN_HOOKS, (resolved) => resolved.hooks),
        derive(ADMIN_ACTIONS, (resolved) => resolved.actions),
        derive(ADMIN_DASHBOARD, (resolved) => resolved.dashboard),
        derive(ADMIN_AUTH, (resolved) => resolved.auth),
        derive(ADMIN_RESOURCE_AUTH, (resolved) => resolvePolicy(resolved)),
        derive(ADMIN_CAPABILITIES, (resolved) =>
          capabilityChecker(resolved.roles, resolved.roleOf),
        ),
      ],
      options.imports ?? [],
    )
  }
}
