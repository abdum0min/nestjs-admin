/**
 * `@nest-admin/nest-admin` - the NestJS integration and the single published
 * package.
 *
 * Nothing is implemented yet. When it is, this entrypoint will export:
 *
 *   - `AdminModule.forRoot(...)` / `forRootAsync(...)`
 *   - the admin HTTP controllers backed by the generic CRUD engine
 *   - the static handler serving the built React admin UI under the configured
 *     base path (`/admin` by default)
 *   - runtime configuration wiring
 *
 * The integration source imports `@nest-admin/core` only. ORM adapters are
 * supplied by the consumer through module options and re-exported from
 * dedicated subpaths (see `./prisma`).
 */

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

export { NestAdminError } from '@nest-admin/core'
