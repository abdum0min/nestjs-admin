# @nest-admin/nestjs

An admin panel for NestJS applications, generated from your ORM schema.

Add one module to an existing application and get list, create, read, update and
delete screens for every model — with search, filters, sorting, pagination,
relation pickers, a dashboard and a login page. No generated files, no
scaffolding to maintain, and no build step in your project: the interface ships
built, inside this package.

```bash
npm install @nest-admin/nestjs
```

```ts
import { Module } from '@nestjs/common'
import { AdminModule, unsafeAllowAllRequests } from '@nest-admin/nestjs'
import { PrismaAdapter } from '@nest-admin/nestjs/prisma'

@Module({
  imports: [
    AdminModule.forRoot({
      adapter: new PrismaAdapter({ client: prisma }),
      auth: unsafeAllowAllRequests(), // development only - see below
    }),
  ],
})
export class AppModule {}
```

Open `/admin`.

Node ≥ 20.11 · NestJS 10–12 · Prisma ≥ 6 or Drizzle ≥ 0.44

---

## Two ORMs, one contract

The adapter is a subpath, so an application that never imports one never loads
its code:

```ts
import { PrismaAdapter } from '@nest-admin/nestjs/prisma'
new PrismaAdapter({ client: prisma })

import { DrizzleAdapter } from '@nest-admin/nestjs/drizzle'
new DrizzleAdapter({ db, schema }) // pass the schema module itself
```

Everything above the adapter is identical either way — the HTTP layer and the
interface have no knowledge of any ORM, and that is enforced by tests rather
than by discipline.

## Authentication is required

The admin exposes every record and, through `/admin/meta`, the whole schema. It
is never public by default.

**If your application already has identity**, supply the decision:

```ts
import { ForbiddenError, UnauthorizedError, type AdminAuth } from '@nest-admin/nestjs'

const auth: AdminAuth = {
  authorize(context) {
    const request = context.switchToHttp().getRequest()
    if (!request.user) throw new UnauthorizedError('Sign in first.')
    if (!request.user.isStaff) throw new ForbiddenError('Staff only.')
  },
}
```

| Outcome                     | How                          | HTTP |
| --------------------------- | ---------------------------- | ---: |
| Allow                       | return (or resolve) normally |  2xx |
| No identity                 | throw `UnauthorizedError`    |  401 |
| Identity, but not permitted | throw `ForbiddenError`       |  403 |
| Denied without saying which | return `false`               |  403 |

`authorize` may be sync or async and receives the NestJS `ExecutionContext`, so
you can read whatever principal your own middleware attached. Throwing is
preferred: `false` cannot express the 401/403 distinction, and a client can act
on "sign in" but not on "denied". If your auth code throws anything else the
request is **refused** with a generic 500 — a bug in authentication never
becomes an accidental allow.

**If it does not**, `builtInAuth()` provides a login screen, a signed session
cookie and scrypt password hashing:

```ts
import { builtInAuth } from '@nest-admin/nestjs'
import { prismaAccountStore } from '@nest-admin/nestjs/prisma'

auth: builtInAuth({
  store: prismaAccountStore({ client: prisma }),
  session: { secret: process.env.ADMIN_SESSION_SECRET },
})
```

Its accounts live in a table of their own, **not** your `User` table. The people
who administer a system are not rows in the table they administer.

For local development only, `unsafeAllowAllRequests()` makes the whole admin
public and logs a warning on every startup.

## Per-model authorization

Optional. Omitting it permits every model, which is not a hole — `auth` already
gates entry.

```ts
resourceAuth: {
  authorize({ context, model, operation }) {
    const { user } = context.switchToHttp().getRequest()
    if (model === 'AuditLog') return user.isAdmin
    if (operation === 'delete') return user.isAdmin
    return true
  },
}
```

`operation` is one of `metadata`, `list`, `read`, `create`, `update`, `delete`.

| Operation     | Denied means                                                   |
| ------------- | -------------------------------------------------------------- |
| `metadata`    | the model is **omitted** from `GET /admin/meta` — not an error |
| anything else | `403 FORBIDDEN`, and the adapter is never called               |

A model hidden from metadata also has any relation **pointing at it** removed
from the models that remain, so its name cannot leak through
`relation.targetModel`. There is no client-side hiding anywhere in the admin.

Row-level rules — "only their own orders" — do not exist yet.

## What else you can configure

```ts
resources: { exclude: ['AdminAccount'] },   // which models are part of the admin
models: { User: { label: 'People', fields: { bio: { widget: 'textarea' } } } },
hooks: { Post: { beforeCreate: ({ data }) => ({ ...data, slug: slugify(data.title) }) } },
actions: { Post: [{ name: 'publish', scope: 'record', run: async ({ id }) => ({ message: 'Done' }) }] },
dashboard: [{ kind: 'count', title: 'Customers', model: 'User', compareDays: 30 }],
theme: { title: 'Acme Admin', brandColor: '#3f6212' },
path: '/admin',
```

Field options divide on a line worth knowing: `hidden`, `readOnly`, `writeOnly`
and `displayField` are **enforced by the server**; `label`, `widget`, `order`
and `icon` are presentation, sent to a client that could ignore them.

Full reference: [docs/configuration.md](../../docs/configuration.md).

## The admin interface

The built interface ships inside this package. Two routes serve it, matched
**before** the API routes so `assets` is never read as a model name:

| Route                     | Serves                     |
| ------------------------- | -------------------------- |
| `GET /admin`              | the SPA shell (`no-cache`) |
| `GET /admin/assets/:file` | hashed bundles (immutable) |

Routing is hash-based (`/admin#/User/u1`), so deep links are still requests for
`/admin` and no catch-all fallback is needed — a fallback would have to match
`/admin/*`, which is exactly the space the API occupies.

**The shell is served without authentication, deliberately.** It is a static
bundle: no records, no schema, identical for every visitor. It discovers what
exists by calling `/admin/meta`, which _is_ guarded. Guarding the shell would
render a JSON 401 in the browser instead of a page that can explain itself.

The mount path is configurable; the bundle is rewritten to match as it is
served, so `path: '/backoffice'` needs no rebuild.

## HTTP contract

| Method   | Route                                   | Purpose                                         |
| -------- | --------------------------------------- | ----------------------------------------------- |
| `GET`    | `/admin/meta`                           | Models and fields, filtered by what you may see |
| `GET`    | `/admin/dashboard`                      | The landing page's widgets, already resolved    |
| `GET`    | `/admin/:model`                         | List records                                    |
| `GET`    | `/admin/:model/:id`                     | Read one                                        |
| `POST`   | `/admin/:model`                         | Create                                          |
| `PATCH`  | `/admin/:model/:id`                     | Update                                          |
| `DELETE` | `/admin/:model/:id`                     | Delete                                          |
| `DELETE` | `/admin/:model`                         | Delete several                                  |
| `GET`    | `/admin/:model/:id/:relation`           | A page of related records                       |
| `POST`   | `/admin/:model/:id/:relation`           | Attach                                          |
| `DELETE` | `/admin/:model/:id/:relation/:targetId` | Detach                                          |
| `POST`   | `/admin/actions/:model/:action`         | Run a declared action                           |

`:model` is the model name exactly as the schema declares it. Under Drizzle that
is the key you exported the table under.

### Query syntax

Only `page`, `perPage`, `search`, `sort` and `filter` are accepted. Anything
else is a `400` — including bracket syntax (`?filter[age][gte]=18`), which used
to be ignored, so a caller believed it had filtered and received every record.

```text
?page=2&perPage=25&search=ada
?sort=email:asc&sort=createdAt:desc
?filter=age:gte:18&filter=role:in:ADMIN,USER
```

`sort` and `filter` are repeatable and order is preserved. A filter is
`field:operator:value`, split into at most three parts so colons inside a value
survive. Operators: `eq`, `ne`, `contains`, `startsWith`, `endsWith`, `gt`,
`gte`, `lt`, `lte`, `in`. Values are coerced from the field's declared type, so
`age:gte:30` reaches the ORM as a number and `active:eq:true` as a boolean.

### Response envelope

```jsonc
// success
{ "success": true, "data": {}, "meta": { "total": 3, "page": 1, "perPage": 25 } }

// failure
{ "success": false, "error": { "code": "MODEL_NOT_FOUND", "message": "…", "details": {} } }
```

`meta` is present on list responses only.

### Errors

| Code                                                     | Status |
| -------------------------------------------------------- | -----: |
| `UNAUTHORIZED`                                           |    401 |
| `FORBIDDEN`                                              |    403 |
| `MODEL_NOT_FOUND` / `RECORD_NOT_FOUND`                   |    404 |
| `FIELD_NOT_FOUND` / `INVALID_QUERY` / `VALIDATION_ERROR` |    400 |
| `CONSTRAINT_VIOLATION`                                   |    409 |
| `INTERNAL_ERROR`                                         |    500 |

Only those messages are forwarded. Everything else becomes a generic 500 and is
logged server-side: an ORM's own message carries call sites, filesystem paths
and sometimes the submitted data, and none of that belongs in a browser.
`CONSTRAINT_VIOLATION` carries `details.fields`, which is how "that email is
taken" lands under the email box rather than in a banner.

## Documentation

- [Getting started](../../docs/getting-started.md)
- [Configuration reference](../../docs/configuration.md)
- [Adapters, and writing one](../../docs/adapters.md)
- [Architecture](../../docs/architecture.md)
- [What exists and what does not](../../docs/status.md)

## License

MIT
