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

export type { AdminHookContext, AdminHooks, AdminHooksByModel } from './hooks/contract.js'

export {
  AdminModule,
  type AdminModuleAsyncOptions,
  type AdminModuleFactoryOptions,
  type AdminModuleOptions,
  type AdminModuleOptionsFactory,
} from './module.js'

// The authentication boundary the consuming application implements. The guard
// that calls it is internal - a consumer supplies the decision, not the wiring.
export { unsafeAllowAllRequests, type AdminAuth } from './auth/contract.js'

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
  ConstraintKind,
  FieldKind,
  FieldOverride,
  FieldWidget,
  FieldMetadata,
  FilterOperator,
  FilterRule,
  ListQuery,
  ModelMetadata,
  ModelOverride,
  ModelOverrides,
  OrmAdapter,
  Page,
  RecordData,
  RecordId,
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
