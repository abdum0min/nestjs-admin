# @nest-admin/nest-admin

The NestJS integration — and **the single package published to npm**.

The name is a placeholder. The final brand/package name is not decided.

## Usage

```ts
import { AdminModule } from '@nest-admin/nest-admin'
import { PrismaAdapter } from '@nest-admin/nest-admin/prisma'
import { PrismaClient } from './generated/prisma/client'

const prisma = new PrismaClient({ adapter: /* your driver adapter */ })

@Module({
  imports: [AdminModule.forRoot({ adapter: new PrismaAdapter({ client: prisma }) })],
})
export class AppModule {}
```

The application constructs the client and the adapter. The framework never
does: under Prisma 7 a client is built from a driver adapter, so only the
application knows the provider, credentials and connection strategy.

## HTTP contract

All routes are mounted under a fixed `/admin` prefix.

| Method   | Route               | Purpose                      |
| -------- | ------------------- | ---------------------------- |
| `GET`    | `/admin/meta`       | Models and fields for the UI |
| `GET`    | `/admin/:model`     | List records                 |
| `GET`    | `/admin/:model/:id` | Read one record              |
| `POST`   | `/admin/:model`     | Create a record              |
| `PATCH`  | `/admin/:model/:id` | Update a record              |
| `DELETE` | `/admin/:model/:id` | Delete a record              |

`:model` is the model name exactly as the schema declares it — `User`, not
`users`. Matching is case-sensitive; an unknown name returns 404 listing the
models that do exist.

### Query syntax

```text
?page=2
?perPage=25
?search=ada
?sort=email:asc&sort=createdAt:desc
?filter=age:gte:18&filter=role:in:ADMIN,USER
```

`sort` and `filter` are repeatable and order is preserved. A filter is
`field:operator:value`, split into at most three parts so colons inside a value
survive. Operators: `eq`, `ne`, `contains`, `startsWith`, `endsWith`, `gt`,
`gte`, `lt`, `lte`, `in`. Values are coerced using the field's declared type,
so `age:gte:30` reaches the ORM as a number.

### Response envelope

```jsonc
// success
{ "success": true, "data": { }, "meta": { "total": 3, "page": 1, "perPage": 25 } }

// failure
{ "success": false, "error": { "code": "MODEL_NOT_FOUND", "message": "…", "details": { } } }
```

`meta` is present on list responses only.

### Error mapping

| Core error            | Status | `error.code`       |
| --------------------- | -----: | ------------------ |
| `ModelNotFoundError`  |    404 | `MODEL_NOT_FOUND`  |
| `RecordNotFoundError` |    404 | `RECORD_NOT_FOUND` |
| `FieldNotFoundError`  |    400 | `FIELD_NOT_FOUND`  |
| `InvalidQueryError`   |    400 | `INVALID_QUERY`    |
| anything else         |    500 | `INTERNAL_ERROR`   |

Only the four errors above have their message forwarded. Everything else —
including `AdapterError`, which wraps raw ORM failures containing filesystem
paths — becomes a generic 500. The real error is logged server-side.

## Rules

- This package imports `@nest-admin/core` only. It has no idea which ORM is in
  use; that is enforced by `tests/boundaries.test.ts`.
- `src/prisma.ts` is the published `./prisma` subpath and exists purely to
  re-export the adapter to consumers. No other file may reach for it.
- The exception filter is applied with `@UseFilters` on the controller, never
  as an `APP_FILTER`. A library must not take over error handling for the host
  application.

## Not implemented

Serving the admin UI under `/admin`, authentication, authorization, the
configuration engine, `forRootAsync`, and a configurable base path. See
[../../reports/004-http-api.md](../../reports/004-http-api.md).
