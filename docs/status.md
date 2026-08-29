# Status: what exists and what does not

Kept honest on purpose. If you are looking for working functionality, this
page is the answer.

## Implemented now

| Thing                                                                                                        | Where                                 |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| pnpm workspace, catalog-pinned shared versions                                                               | `pnpm-workspace.yaml`                 |
| Shared TypeScript base config (strict)                                                                       | `tsconfig.json`                       |
| Prettier, Vitest, `.gitignore`, `.editorconfig`, MIT license                                                 | root                                  |
| Five packages + admin app + example, with build/typecheck wiring                                             | `packages/`, `apps/`, `examples/`     |
| tsup build config per package (ESM + CJS + d.ts)                                                             | `packages/*/tsup.config.ts`           |
| Vite build config for the SPA, based at `/admin/`                                                            | `apps/admin-ui/vite.config.ts`        |
| Core contract types: `ModelMetadata`, `OrmAdapter`, `ListQuery`, `Page`, `NestAdminConfig`, `NestAdminError` | `packages/core/src`                   |
| Reference Prisma schema with `User` and `Product`                                                            | `examples/basic/prisma/schema.prisma` |
| Single-public-package bundling strategy                                                                      | `docs/publishing.md`                  |

The Core contracts are **type declarations only**. There is no runtime logic
anywhere in this repository apart from one base `Error` subclass.

## Not implemented

Everything else, specifically:

- Prisma adapter: DMMF reading, model resolution, query translation, CRUD
- Generic CRUD engine, resource registry, query abstraction
- `AdminModule`, admin controllers, admin HTTP API
- Static serving of the SPA under `/admin`
- The admin UI: resource list, tables, forms, pagination, search
- Any UI component in `packages/ui`
- `nest-admin init` and every other CLI command (no `bin` is declared)
- The configuration system (only the `NestAdminConfig` type exists)
- Project and Prisma detection
- Authentication, authorization, RBAC, permissions
- Uploads, rich text, charts, analytics, audit logs, webhooks
- Custom pages, plugins, multi-tenancy, SaaS features
- TypeORM, Drizzle and MikroORM adapters

Nothing has been published to npm.

## Known blocker for the MVP

Prisma 7 does not expose enough model metadata through any public API to
identify a primary key. See [prisma-metadata.md](prisma-metadata.md). This
must be settled before the Prisma adapter is written.
