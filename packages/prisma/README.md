# @nest-admin/prisma

Prisma adapter. Internal package — bundled into the single public package.

**Nothing is implemented yet.** This package currently establishes the
boundary only.

## Planned responsibility

Implement exactly one thing: `OrmAdapter` from `@nest-admin/core`.

- Read metadata from the generated client's DMMF and map it to `ModelMetadata`
- Resolve a model name to a Prisma Client delegate
- Translate `ListQuery` (filters, sort, pagination, search) into `findMany` args
- Execute create / read / update / delete

## Rules

- `@prisma/client` is a **peer dependency**. The consuming application owns the
  generated client; a bundled second copy would have no schema attached to it.
- This package may import `@nest-admin/core`. Core may never import this one.
