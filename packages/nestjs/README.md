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
  imports: [
    AdminModule.forRoot({
      adapter: new PrismaAdapter({ client: prisma }),
      auth: {
        authorize(context) {
          const request = context.switchToHttp().getRequest()
          if (!request.user) throw new UnauthorizedError()
          if (!request.user.isStaff) throw new ForbiddenError()
        },
      },
    }),
  ],
})
export class AppModule {}
```

## Authentication

`auth` is **required**. The admin exposes every record and, through
`/admin/meta`, the whole schema, so it is never public by default. Nest Admin
does not authenticate anyone - your application already has identity, and a
second one would be a new attack surface. You supply the decision:

| Outcome                   | How                          | HTTP |
| ------------------------- | ---------------------------- | ---: |
| Allow                     | return (or resolve) normally |  2xx |
| No identity               | throw `UnauthorizedError`    |  401 |
| Identity, but not allowed | throw `ForbiddenError`       |  403 |
| Denied without saying why | return `false`               |  403 |

`authorize` may be sync or async and receives the NestJS `ExecutionContext`, so
you can read whatever principal your own middleware attached to the request, and
the `model` route parameter on per-model routes.

If the host's auth code throws anything else, the request is **refused** with a
generic 500 - a bug in authentication never becomes an accidental allow.

For local development only:

```ts
import { unsafeAllowAllRequests } from '@nest-admin/nest-admin'

AdminModule.forRoot({ adapter, auth: unsafeAllowAllRequests() })
```

It makes the entire admin public and logs a warning on every startup.

## Resource authorization

Optional. Supply `resourceAuth` when some models should be invisible or
read-only to some principals. Omitting it permits every model - which is not a
hole, because `auth` already gates entry.

```ts
AdminModule.forRoot({
  adapter,
  auth,
  resourceAuth: {
    authorize({ context, model, operation }) {
      const { user } = context.switchToHttp().getRequest()
      if (model === 'AuditLog') return user.isAdmin
      if (operation === 'delete') return user.isAdmin
      return true
    },
  },
})
```

`operation` is one of `metadata`, `list`, `read`, `create`, `update`, `delete`.
Return `true`/nothing to allow; return `false` or throw `ForbiddenError` to
deny. Sync or async.

The consequence of a denial depends on the operation:

| Operation     | Denied means                                                   |
| ------------- | -------------------------------------------------------------- |
| `metadata`    | the model is **omitted** from `GET /admin/meta` - not an error |
| anything else | `403 FORBIDDEN`, and the ORM adapter is never called           |

A model hidden from metadata also has any relation **pointing at it** removed
from the models that remain, so its name cannot leak through
`relation.targetModel`.

Anything else the policy throws is a bug in the host: the request fails with a
generic 500 and the real error is logged. A failing policy never allows access.

The application constructs the client and the adapter. The framework never
does: under Prisma 7 a client is built from a driver adapter, so only the
application knows the provider, credentials and connection strategy.

## The admin UI

The built interface ships inside this package. Once `AdminModule` is imported,
open `/admin` in a browser - no extra install, no static-file configuration, no
build step in the consuming project.

Two routes serve it, and they are matched **before** the API routes so `assets`
is never read as a model name:

| Route                     | Serves                     |
| ------------------------- | -------------------------- |
| `GET /admin`              | the SPA shell (`no-cache`) |
| `GET /admin/assets/:file` | hashed bundles (immutable) |

The UI uses hash routing (`/admin#/User/u1`), so deep links are still requests
for `/admin` and no catch-all fallback is needed - a fallback would have to
match `/admin/*`, which is exactly the space the API occupies.

**The shell is served without authentication, deliberately.** It is a static
bundle: no records, no schema, identical for every visitor. It discovers what
exists by calling `/admin/meta`, which _is_ guarded. Guarding the shell too
would render a JSON 401 in the browser instead of a page that can explain
itself, and would stop you putting your own login redirect in front of it. Every
route that can return data remains protected.

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

Only `page`, `perPage`, `search`, `sort` and `filter` are accepted. Anything
else is a `400` - including bracket syntax (`?filter[age][gte]=18`), which used
to be ignored, so a caller believed it had filtered and received every record.

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
| `UnauthorizedError`   |    401 | `UNAUTHORIZED`     |
| `ForbiddenError`      |    403 | `FORBIDDEN`        |
| `InvalidQueryError`   |    400 | `INVALID_QUERY`    |
| anything else         |    500 | `INTERNAL_ERROR`   |

Only the errors above have their message forwarded. Everything else —
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

Serving the admin UI under `/admin`, field-level permissions, the configuration
engine, `forRootAsync`, and a configurable base path. See
[../../reports/004-http-api.md](../../reports/004-http-api.md).
