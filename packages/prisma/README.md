# @nest-admin/prisma

The Prisma adapter. Internal package — bundled into the single public package.

Implements Core's `OrmAdapter` against a Prisma Client: model discovery,
generic CRUD, pagination, sorting, filtering and search.

## Usage

The consuming application constructs the Prisma Client and hands it over.
Prisma 7 builds clients from driver adapters, so only the application knows the
provider, the credentials and the connection strategy — the adapter never calls
`new PrismaClient()`.

```ts
import { PrismaAdapter } from '@nest-admin/prisma'

const adapter = new PrismaAdapter({ client: prisma })

await adapter.getModels()
await adapter.list('User', { page: 1, perPage: 25 })
await adapter.findOne('User', id)
await adapter.create('User', { email, name })
await adapter.update('User', id, { name })
await adapter.delete('User', id)
```

`schemaPath` may be passed explicitly; otherwise `prisma/schema.prisma`,
`prisma/schema` and `schema.prisma` are tried in that order. Both a single
file and a directory of `.prisma` files are supported.

## Layout

```text
src/
  adapter.ts                 PrismaAdapter - implements OrmAdapter
  metadata/
    read-dmmf.ts             the ONLY module importing @prisma/get-dmmf
    to-metadata.ts           DMMF -> Core ModelMetadata
  query/
    to-prisma-args.ts        ListQuery -> findMany args, with validation
  client/
    delegate.ts              dynamic model resolution (the one type escape)
```

## Rules

- This package may import `@nest-admin/core`. Core may never import this one.
- `@prisma/get-dmmf` may be imported by exactly ONE module
  (`metadata/read-dmmf.ts`). That confinement is what keeps the future switch
  to a Prisma generator a one-file change.
- `@prisma/client` is a **peer dependency**. The consuming application owns the
  generated client; a bundled second copy would have no schema attached.
- No DMMF type escapes `metadata/`. Everything downstream sees Core shapes.
- The public export surface is `PrismaAdapter` plus the two schema errors.
  Internal helpers stay internal.

## Tests

Integration tests run against a real SQLite database — nothing is mocked. The
fixture client and database are generated automatically before the suite by
`test/global-setup.ts`, so no external service and no developer-specific
configuration is needed.

```bash
pnpm --filter @nest-admin/prisma exec vitest run
```

See [../../docs/adapters.md](../../docs/adapters.md)
for the design decisions and known limitations.
