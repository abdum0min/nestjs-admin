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

export type { ModelIcon } from './config/overrides.js'
export { displayFieldFor } from './metadata/display-field.js'

export type { RelationShape } from './metadata/relation-shape.js'
export {
  detachBlockedReason,
  inverseRelationField,
  relationShape,
} from './metadata/relation-shape.js'

export type {
  FilterOperator,
  FilterRule,
  ListQuery,
  Page,
  SortDirection,
  SortRule,
} from './query/query.js'

export type { OrmAdapter, RecordData, RecordId } from './adapter/orm-adapter.js'

export type {
  FieldOverride,
  FieldWidget,
  ModelOverride,
  ModelOverrides,
} from './config/overrides.js'
export type { ResourceSelection } from './config/resources.js'
export { selectModels, unknownSelectionNames } from './config/resources.js'
export {
  applyOverrides,
  fieldOverride,
  isReadOnly,
  unknownOverrideNames,
  unwritableHiddenFields,
} from './config/overrides.js'

export type { AdminErrorKind, ConstraintKind } from './errors/errors.js'

export {
  AdapterError,
  ConstraintError,
  FieldNotFoundError,
  ForbiddenError,
  InvalidQueryError,
  isNestAdminError,
  ModelNotFoundError,
  NestAdminError,
  RecordNotFoundError,
  UnauthorizedError,
  ValidationError,
} from './errors/errors.js'
