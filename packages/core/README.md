# @nest-admin/core

The ORM-agnostic engine. Internal package — not published on its own; it is
bundled into the single public package at build time.

## Rules

- **No Prisma.** Not the client, not the types.
- **No NestJS.** Core must stay usable outside Nest.
- No runtime dependencies.

## Current contents

Contracts only:

| Export              | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `ModelMetadata`     | Normalised model/field description every adapter emits |
| `OrmAdapter`        | The single seam between Nest Admin and any ORM         |
| `ListQuery`, `Page` | ORM-independent query and pagination shapes            |
| `NestAdminConfig`   | Type direction for `nest-admin.config.ts`              |
| `NestAdminError`    | Base error type                                        |

All of it is marked `@experimental`.

## Not implemented yet

Resource registry, generic CRUD engine, query translation helpers,
configuration loading, validation.
