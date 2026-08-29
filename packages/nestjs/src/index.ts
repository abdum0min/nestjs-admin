/**
 * `@nest-admin/nest-admin` - the NestJS integration and the single published
 * package.
 *
 * ```ts
 * import { AdminModule } from '@nest-admin/nest-admin'
 * import { PrismaAdapter } from '@nest-admin/nest-admin/prisma'
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

export { AdminModule, type AdminModuleOptions } from './module.js'

// The authentication boundary the consuming application implements. The guard
// that calls it is internal - a consumer supplies the decision, not the wiring.
export { unsafeAllowAllRequests, type AdminAuth } from './auth/contract.js'

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
  ModelDto,
  RelationDto,
} from './admin/metadata.dto.js'

// Core contracts are re-exported so consumers of the single public package can
// type their own adapters and configuration without a second install.
export type {
  FieldKind,
  FieldMetadata,
  FilterOperator,
  FilterRule,
  ListQuery,
  ModelMetadata,
  NestAdminConfig,
  OrmAdapter,
  Page,
  RecordData,
  RecordId,
  RelationCardinality,
  RelationMetadata,
  ResourceSelection,
  SortDirection,
  SortRule,
} from '@nest-admin/core'

export {
  AdapterError,
  FieldNotFoundError,
  ForbiddenError,
  InvalidQueryError,
  ModelNotFoundError,
  NestAdminError,
  RecordNotFoundError,
  UnauthorizedError,
} from '@nest-admin/core'
