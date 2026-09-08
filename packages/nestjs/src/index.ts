/**
 * `@nest-admin/nestjs` - the NestJS integration and the single published
 * package.
 *
 * ```ts
 * import { AdminModule } from '@nest-admin/nestjs'
 * import { PrismaAdapter } from '@nest-admin/nestjs/prisma'
 *
 * @Module({
 *   imports: [AdminModule.forRoot({ adapter: new PrismaAdapter({ client: prisma }) })],
 * })
 * export class AppModule {}
 * ```
 *
 * The integration source imports `@nest-admin/core` only - it has no idea
 * which ORM is underneath. ORM adapters reach consumers through dedicated
 * subpaths (see `./prisma`).
 *
 * Implemented: the admin HTTP API (metadata + generic CRUD) behind a
 * host-supplied authentication boundary.
 * Not implemented: static serving of the admin UI, resource-level permissions,
 * and the configuration engine.
 */

export type { AdminAction, AdminActionResult, AdminActionsByModel } from './actions/contract.js'
export type {
  ExportRequest,
  ImportOutcome,
  ImportPlan,
  ImportRequest,
  ImportShape,
  PlannedRow,
  TransferFormat,
} from './transfer/contract.js'
export type { ExportColumn, ImportTarget } from './transfer/columns.js'

export type { AdminHookContext, AdminHooks, AdminHooksByModel } from './hooks/contract.js'

export {
  AdminModule,
  type AdminModuleAsyncOptions,
  type AdminModuleFactoryOptions,
  type AdminModuleOptions,
  type AdminModuleOptionsFactory,
} from './module.js'
export type { AdminFonts, AdminPalette, AdminTheme } from './ui/theme.js'

// The authentication boundary the consuming application implements. A consumer
// supplies the decision; the guard below is how they reuse it.
export { unsafeAllowAllRequests, type AdminAuth } from './auth/contract.js'

/**
 * The guard the admin's own routes run behind, for your controllers too.
 *
 * A custom page needs an API, and that API needs the same protection the admin
 * has - otherwise adding a page means reimplementing authentication, and one
 * of the two implementations will be the weaker.
 *
 * ```ts
 * @Controller('admin/reports')
 * @UseGuards(AdminAuthGuard)
 * @UseFilters(AdminExceptionFilter)
 * export class ReportsController { … }
 * ```
 *
 * Declare the controller in the module that imports `AdminModule.forRoot(…)`,
 * so Nest can resolve the guard's dependencies. It calls the same `AdminAuth`
 * the admin was configured with, which means one session, one policy, and one
 * place to change either.
 *
 * **Use the filter with it.** The guard refuses by throwing this package's
 * `UnauthorizedError`, which is not one of Nest's exceptions - without the
 * filter to map it, an unauthenticated request to your endpoint answers 500
 * instead of 401, and the admin's own client cannot tell it is a sign-in
 * problem. With it, your route answers in the same envelope as every other
 * route in the admin.
 */
export { AdminAuthGuard } from './auth/guard.js'

/**
 * The admin's error mapping, for controllers of your own.
 *
 * Turns this package's errors into the admin's `{ success, error }` envelope
 * with the right status. Pair it with `AdminAuthGuard`; see the note there.
 * Nest's own `HttpException`s pass through untouched, so throwing
 * `NotFoundException` from your route still behaves as it always did.
 */
export { AdminExceptionFilter } from './http/exception.filter.js'

export type { AdminPage, AdminPages, EmbedPage, ModulePage, WidgetPage } from './pages/contract.js'

// An implementation of that boundary, for applications that do not have an
// identity system of their own. The contract above is unchanged and is still
// the only way in; this is one thing that satisfies it.
export { adminAccountOf, builtInAuth, type BuiltInAuthOptions } from './auth/built-in.js'
export { hashAdminPassword, verifyAdminPassword } from './auth/password.js'
export { generateSessionSecret } from './auth/session.js'
export type { AdminAccount, AdminAccountStore, AdminAccountSummary } from '@nest-admin/core'

// Resource-level authorization: which models a principal may see and act on.
// The enforcement point is internal; the consumer supplies only the decision.
export type { AdminOperation, AdminResourceAuth, ResourceAuthorization } from './auth/resource.js'

// What the dashboard shows. A closed set of four kinds, drawn by the interface
// from data - the same arrangement as actions, and for the same reason.
export type {
  AdminDashboard,
  ChartWidget,
  CountWidget,
  DashboardWidget,
  ListWidget,
  StatResult,
  StatWidget,
  WidgetSpan,
} from './dashboard/contract.js'

// Roles: a shorthand that compiles into the resource-authorization contract,
// so an application can start with roles and drop to a function later without
// changing anything it already relies on.
export { builtInRoleOf } from './auth/built-in.js'
export type {
  AdminCapability,
  AdminRoles,
  RoleDefinition,
  RolePermissions,
  RoleResolver,
} from './auth/roles.js'

// The HTTP contract. Exported as types so a consumer - and the future admin
// UI - can type responses without restating the shapes.
export type {
  AdminErrorCode,
  AdminResponse,
  ErrorResponse,
  PageMeta,
  SuccessResponse,
} from './http/response.js'

export type {
  FieldDto,
  FieldKindDto,
  MetadataDto,
  ActionDto,
  ModelDto,
  RelationDto,
} from './admin/metadata.dto.js'

// Core contracts are re-exported so consumers of the single public package can
// type their own adapters and configuration without a second install.
export type {
  AdminErrorKind,
  AdminNavigation,
  ConstraintKind,
  DetailPresentation,
  DetailSection,
  FieldKind,
  FieldOverride,
  FieldWidget,
  FieldMetadata,
  FilterOperator,
  FilterRule,
  ListPresentation,
  ListQuery,
  ModelIcon,
  ModelMetadata,
  ModelOverride,
  ModelOverrides,
  OrmAdapter,
  Page,
  RecordData,
  RecordId,
  NavigationDivider,
  NavigationEntry,
  NavigationGroup,
  NavigationLink,
  RelationCardinality,
  RelationMetadata,
  SortDirection,
  SortRule,
} from '@nest-admin/core'

export {
  AdapterError,
  ConstraintError,
  FieldNotFoundError,
  ForbiddenError,
  InvalidQueryError,
  // Errors cross bundle boundaries, so `instanceof` is not reliable for them -
  // see the note in Core's `errors.ts`. Consumers that need to recognise a
  // framework error must have the same guard the framework uses.
  isNestAdminError,
  ModelNotFoundError,
  NestAdminError,
  RecordNotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@nest-admin/core'
