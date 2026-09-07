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
import type {
  AdminNavigation,
  ModelOverrides,
  OrmAdapter,
  ResourceSelection,
} from '@nest-admin/core'
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
import type { DevToolsContribution } from './dev-tools/contract.js'
import { AdminAuthController } from './auth/controller.js'
import { AdminService } from './admin/service.js'
import { warnIfUnsafe, type AdminAuth } from './auth/contract.js'
import { AdminAuthGuard } from './auth/guard.js'
import { adminAccountOf, builtInRuntimeOf } from './auth/built-in.js'
import type { AdminStorage } from '@nest-admin/core'
import { allowAllResources, type AdminResourceAuth } from './auth/resource.js'
import { AdminFilesController, type FilesRuntime } from './files/controller.js'
import { AdminTransferController } from './transfer/controller.js'
import { TransferService } from './transfer/service.js'
import { isLocalStorage, localStorage } from './files/local.js'
import { toBytes } from './files/sniff.js'

/** The ceiling when nothing narrows it. Generous for a picture, mean for a video. */
const DEFAULT_MAX_UPLOAD = '10mb'

export interface AdminFilesOptions {
  /** Where the bytes go. The local disk when omitted. */
  readonly storage?: AdminStorage
  /** Only used by the local store. */
  readonly directory?: string
  /** The largest upload any field may take. Bytes, or `'10mb'`. */
  readonly maxSize?: number | string
}
import { AdminTeamController } from './auth/team.controller.js'
import { TeamService, teamAvailable } from './auth/team.js'
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
  ADMIN_NAVIGATION,
  ADMIN_MOUNT_PATH,
  ADMIN_OPTIONS,
  ADMIN_CAPABILITIES,
  ADMIN_CONCURRENCY,
  ADMIN_DEV_TOOLS,
  ADMIN_FILES,
  ADMIN_TEAM,
  ADMIN_RESOURCE_AUTH,
  ADMIN_RESOURCES,
  ADMIN_SERVICE,
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
   * What happens when two people edit the same record.
   *
   * `'last-write-wins'` is the default and is what the admin has always done:
   * the second save overwrites the first, and neither person is told. That is
   * fine while there is one administrator, and this release is the one that
   * stops being true.
   *
   * `'optimistic'` refuses a write whose version no longer matches the stored
   * one, with a 409 and nothing applied. It needs a field the schema updates on
   * every write - `updatedAt` and its usual spellings - and warns at startup
   * for every model that has none, because a guard nobody can see is not a
   * guard.
   *
   * Opt-in, because turning it on can refuse a write that succeeds today, and
   * "zero configuration behaves exactly as before" is a rule this release is
   * not going to break for a default.
   */
  readonly concurrency?: 'last-write-wins' | 'optimistic'

  /**
   * Where uploaded files go, and how large they may be.
   *
   * Omitted, files go to the local disk under `.nest-admin/uploads` and work
   * immediately - which is the point: choosing a storage backend should not be
   * the first thing between somebody and a working image field.
   *
   * `false` turns the routes off entirely for an admin that has no file fields
   * and would rather not serve any.
   */
  readonly files?: AdminFilesOptions | false

  /**
   * The developer tools, if this build has them.
   *
   * ```ts
   * import { devTools } from '@nest-admin/nestjs/dev-tools'
   *
   * AdminModule.forRoot({ adapter, auth, devTools: devTools() })
   * ```
   *
   * **Structural**, like `path` and `theme`: it decides which controllers the
   * module registers, and that happens before any provider exists. On
   * `forRootAsync` it belongs on the outer object, not on what the factory
   * returns.
   *
   * The type is deliberately what `devTools()` returns rather than a set of
   * options, so nothing in the main entrypoint imports the generator: an
   * application that does not import the subpath does not have any of it.
   */
  readonly devTools?: DevToolsContribution

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
   * How the resources are grouped in the sidebar.
   *
   * Headings, ordering, dividers and links out. A model not named in any group
   * is not hidden - it lands in a final group, because a model that vanished
   * from the admin when somebody edited a list is worse than an untidy
   * sidebar. Hiding one is what `resources` is for.
   *
   * A name matching no model fails at startup.
   */
  readonly navigation?: AdminNavigation

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
export type AdminModuleFactoryOptions = Omit<
  AdminModuleOptions,
  'path' | 'uiRoot' | 'theme' | 'devTools'
>

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

  /**
   * As `AdminModuleOptions.devTools`. Structural for the same reason: it
   * decides which controllers are registered, which happens before a factory
   * has run.
   */
  readonly devTools?: DevToolsContribution

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

/**
 * The team service, when this deployment can have one.
 *
 * Three things have to be true: the login is the built-in one, its store can
 * list accounts, and - for writes - it can also create, update and delete. Any
 * of them missing and the routes answer 404, because the feature is not part
 * of that admin rather than forbidden inside it.
 */
function resolveTeam(options: {
  readonly auth: AdminAuth
  readonly roles?: AdminRoles
  readonly roleOf?: RoleResolver
}): TeamService | undefined {
  const runtime = builtInRuntimeOf(options.auth)
  if (runtime === undefined || !teamAvailable(runtime.store)) return undefined

  return new TeamService({
    store: runtime.store,
    roles: options.roles,
    can: capabilityChecker(options.roles, options.roleOf),
    accountOf: adminAccountOf,
  })
}

/**
 * File storage, when this admin has any.
 *
 * Undefined only when `files: false` was asked for. Otherwise the local disk,
 * because an `image` widget that needs a decision before it works is an
 * `image` widget nobody tries.
 */
function resolveFiles(
  options: { readonly files?: AdminFilesOptions | false },
  mountPath: string,
): FilesRuntime | undefined {
  if (options.files === false) return undefined

  const declared = options.files ?? {}
  const storage =
    declared.storage ??
    localStorage({
      ...(declared.directory === undefined ? {} : { directory: declared.directory }),
      route: `${mountPath}/files`,
    })

  const runtime = { storage, maxSize: toBytes(declared.maxSize ?? DEFAULT_MAX_UPLOAD) }
  warnAboutLocalStorage(runtime)
  return runtime
}

/**
 * Say so when files are going somewhere that will not survive a deploy.
 *
 * A container, a serverless function and most PaaS dynos have filesystems that
 * reset. The local store is the right default because it makes an image field
 * work with no decisions at all; it is the wrong thing to still be using in
 * production, and "the avatars vanished last Tuesday" is not a discovery
 * anyone should make from a support ticket.
 *
 * NODE_ENV is a hint rather than the check - staging runs as production and
 * some hosts set nothing - so this warns and never refuses.
 */
function warnAboutLocalStorage(files: FilesRuntime | undefined): void {
  if (files === undefined || !isLocalStorage(files.storage)) return
  if (process.env['NODE_ENV'] !== 'production') return

  new Logger('NestAdmin').warn(
    `Uploaded files are being written to ${files.storage.directory}. On a ` +
      'container or a serverless host that directory is lost on the next deploy. ' +
      'Pass `files: { storage }` to keep them somewhere durable.',
  )
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
  /**
   * What `devTools()` returned, when the application imported it.
   *
   * Passed in rather than imported: nothing in this file references the
   * dev-tools directory, which is what keeps the generator, the word lists and
   * the routes out of a build that never asked for them.
   */
  devTools?: DevToolsContribution,
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
    // Order decides: every literal segment has to be declared before the
    // controller that owns the `:model` parameter, or the parameter swallows it.
    controllers: [
      AdminUiController,
      AdminAuthController,
      AdminTeamController,
      AdminFilesController,
      AdminTransferController,
      // Before the controller that owns `:model`, like every other literal.
      ...(devTools?.controllers ?? []),
      AdminController,
    ],
    providers: [
      ...optionProviders,
      ...(devTools?.providers ?? []),
      { provide: ADMIN_UI_ROOT, useValue: resolvedUiRoot },
      { provide: ADMIN_MOUNT_PATH, useValue: mountPath },
      { provide: ADMIN_THEME, useValue: theme },
      AdminService,
      TransferService,
      // The same instance, reachable by token. Anything in another
      // entrypoint holds a different copy of the class object and cannot ask
      // for it by name - see ADMIN_SERVICE in tokens.ts.
      { provide: ADMIN_SERVICE, useExisting: AdminService },
      // Provided so Nest can resolve them for `@UseGuards` / `@UseFilters` on
      // the controller. Deliberately not APP_GUARD or APP_FILTER: either would
      // take over behaviour for the whole host application rather than just the
      // admin routes.
      AdminAuthGuard,
      AdminExceptionFilter,
    ],
    exports: [AdminService, ADMIN_SERVICE],
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

    const files = resolveFiles(options, mountPath)

    return defineModule(
      mountPath,
      resolvedUiRoot,
      options.theme,
      [
        { provide: ADMIN_ADAPTER, useValue: options.adapter },
        { provide: ADMIN_RESOURCES, useValue: options.resources },
        { provide: ADMIN_MODELS, useValue: options.models },
        { provide: ADMIN_NAVIGATION, useValue: options.navigation },
        { provide: ADMIN_HOOKS, useValue: options.hooks },
        { provide: ADMIN_ACTIONS, useValue: options.actions },
        { provide: ADMIN_DASHBOARD, useValue: options.dashboard },
        { provide: ADMIN_AUTH, useValue: options.auth },
        // Always provided, so injection resolves whether or not the consumer
        // supplied a policy. The default permits every model.
        { provide: ADMIN_RESOURCE_AUTH, useValue: resolvePolicy(options) },
        { provide: ADMIN_CAPABILITIES, useValue: capabilityChecker(options.roles, options.roleOf) },
        { provide: ADMIN_TEAM, useValue: resolveTeam(options) },
        { provide: ADMIN_CONCURRENCY, useValue: options.concurrency ?? 'last-write-wins' },
        { provide: ADMIN_FILES, useValue: files },
        { provide: ADMIN_DEV_TOOLS, useValue: options.devTools?.options },
      ],
      [],
      options.devTools,
    )
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
        derive(ADMIN_NAVIGATION, (resolved) => resolved.navigation),
        derive(ADMIN_HOOKS, (resolved) => resolved.hooks),
        derive(ADMIN_ACTIONS, (resolved) => resolved.actions),
        derive(ADMIN_DASHBOARD, (resolved) => resolved.dashboard),
        derive(ADMIN_AUTH, (resolved) => resolved.auth),
        derive(ADMIN_RESOURCE_AUTH, (resolved) => resolvePolicy(resolved)),
        derive(ADMIN_CAPABILITIES, (resolved) =>
          capabilityChecker(resolved.roles, resolved.roleOf),
        ),
        derive(ADMIN_TEAM, (resolved) => resolveTeam(resolved)),
        derive(ADMIN_CONCURRENCY, (resolved) => resolved.concurrency ?? 'last-write-wins'),
        derive(ADMIN_FILES, (resolved) => resolveFiles(resolved, mountPath)),
        { provide: ADMIN_DEV_TOOLS, useValue: options.devTools?.options },
      ],
      options.imports ?? [],
      options.devTools,
    )
  }
}
