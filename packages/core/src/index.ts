/**
 * `@nest-admin/core` - the ORM-agnostic engine.
 *
 * This package must never import Prisma, NestJS, or any other framework.
 * See CONTRIBUTING.md for the rules that keep that true.
 *
 * At this stage the package contains contracts only; the generic CRUD engine,
 * query abstraction and resource registry are not implemented yet.
 */

export type {
  FieldKind,
  FieldMetadata,
  ModelMetadata,
  RelationCardinality,
  RelationMetadata,
} from './metadata/model.js'

export type {
  FilterOperator,
  FilterRule,
  ListQuery,
  Page,
  SortDirection,
  SortRule,
} from './query/query.js'

export type { OrmAdapter, RecordData, RecordId } from './adapter/orm-adapter.js'

export type { NestAdminConfig, ResourceSelection } from './config/config.js'

export type { AdminErrorKind } from './errors/errors.js'

export {
  AdapterError,
  FieldNotFoundError,
  ForbiddenError,
  InvalidQueryError,
  isNestAdminError,
  ModelNotFoundError,
  NestAdminError,
  RecordNotFoundError,
  UnauthorizedError,
} from './errors/errors.js'
