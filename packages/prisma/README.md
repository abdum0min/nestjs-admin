# @nest-admin/prisma

Prisma adapter. Internal package — bundled into the single public package.

**Nothing is implemented yet.** This package currently establishes the
boundary only.

## Planned responsibility

Implement exactly one thing: `OrmAdapter` from `@nest-admin/core`.

- Read schema metadata via `@prisma/get-dmmf` and map it to `ModelMetadata`
- Resolve a model name to a Prisma Client delegate
- Translate `ListQuery` (filters, sort, pagination, search) into `findMany` args
- Execute create / read / update / delete

Planned layout:

```text
src/
  metadata/
    read-dmmf.ts     <- the ONLY module allowed to import @prisma/get-dmmf
    to-metadata.ts   <- DMMF.Document -> ModelMetadata[]
  adapter.ts         <- implements OrmAdapter
```

The generated Prisma Client does NOT expose enough metadata to drive an admin
panel - it cannot identify a primary key, a required field, or a list. See
[../../reports/002-prisma-metadata-spike.md](../../reports/002-prisma-metadata-spike.md)
for the evidence and the rejected alternatives.

## Rules

- `@prisma/client` is a **peer dependency**. The consuming application owns the
  generated client; a bundled second copy would have no schema attached to it.
- This package may import `@nest-admin/core`. Core may never import this one.
- `@prisma/get-dmmf` may be imported by exactly ONE module (`metadata/read-dmmf.ts`).
  That confinement is what keeps the future switch to a Prisma generator a
  one-file change.
