# Status: what exists and what does not

Kept honest on purpose. If you are looking for working functionality, this
page is the answer.

## Implemented now

| Thing                                                                                                     | Where                                 |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| pnpm workspace, catalog-pinned shared versions                                                            | `pnpm-workspace.yaml`                 |
| Shared TypeScript base config (strict)                                                                    | `tsconfig.json`                       |
| Prettier, Vitest, `.gitignore`, `.editorconfig`, MIT license                                              | root                                  |
| Five packages + admin app + example, with build/typecheck wiring                                          | `packages/`, `apps/`, `examples/`     |
| tsup build config per package (ESM + CJS + d.ts)                                                          | `packages/*/tsup.config.ts`           |
| Vite build config for the SPA, based at `/admin/`                                                         | `apps/admin-ui/vite.config.ts`        |
| Core contract types: `ModelMetadata`, `OrmAdapter`, `ListQuery`, `Page`, `NestAdminConfig`                | `packages/core/src`                   |
| Core error vocabulary: `ModelNotFound`, `FieldNotFound`, `RecordNotFound`, `InvalidQuery`, `AdapterError` | `packages/core/src/errors`            |
| **Prisma metadata reading** (single-file and multi-file schemas)                                          | `packages/prisma/src/metadata`        |
| **DMMF → `ModelMetadata` mapping** (types, keys, unique, optional, list, enums, relations, defaults)      | `packages/prisma/src/metadata`        |
| **`PrismaAdapter`**: `getModels`, `list`, `findOne`, `create`, `update`, `delete`                         | `packages/prisma/src/adapter.ts`      |
| **Dynamic model resolution** against a metadata allowlist                                                 | `packages/prisma/src/client`          |
| **Pagination, sorting, filtering, search** with validation                                                | `packages/prisma/src/query`           |
| **71 tests**, integration tests against a real SQLite database                                            | `packages/prisma/test`                |
| Reference Prisma schema with `User` and `Product`                                                         | `examples/basic/prisma/schema.prisma` |
| Single-public-package bundling strategy                                                                   | `docs/publishing.md`                  |

## Not implemented

Everything else, specifically:

- `AdminModule`, admin controllers, admin HTTP API
- Static serving of the SPA under `/admin`
- The admin UI: resource list, tables, forms, pagination, search
- Any UI component in `packages/ui`
- `nest-admin init` and every other CLI command (no `bin` is declared)
- The configuration system (only the `NestAdminConfig` type exists)
- Project and Prisma detection
- Composite primary keys (represented in metadata, rejected by the adapter)
- Nested relation writes, relation filtering, relation-aware UI
- Authentication, authorization, RBAC, permissions
- Uploads, rich text, charts, analytics, audit logs, webhooks
- Custom pages, plugins, multi-tenancy, SaaS features
- TypeORM, Drizzle and MikroORM adapters

The example project does **not** yet wire the adapter in — there is no
`AdminModule` to wire it into.

Nothing has been published to npm.

## Metadata strategy

`@prisma/get-dmmf` for the MVP, a custom Prisma generator long-term. Decided in
[prisma-metadata.md](prisma-metadata.md) and implemented in Phase 2. Multi-file
schemas are supported natively. Adapter design, tested behaviour and known
limitations: [../reports/003-prisma-adapter.md](../reports/003-prisma-adapter.md).
